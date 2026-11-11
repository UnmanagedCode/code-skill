import { promises as fs } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { buildInventory, findSkill } from '../inventory.js';
import { parseSkillMd, validateFrontmatter, skillFields } from '../skillFile.js';
import { costOf } from '../../shared/cost.js';
import { sha256 } from '../fsx/atomicWrite.js';
import { refuse } from '../safety/errors.js';
import { assertWritableScope, assertToggleScope } from '../safety/resolve.js';
import { createSkill, updateSkill, setEnabled, deleteSkill, restoreSkill, readSkillBytes } from '../authoring.js';
import { listTrash } from '../trash.js';

const MAX_FILES = 200;
const MAX_DEPTH = 3;

// Regular files under a skill folder, relative, depth ≤ 3; symlinks not followed.
async function listFiles(dir) {
  const out = [];
  const walk = async (d, depth) => {
    for (const ent of await fs.readdir(d, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      const p = path.join(d, ent.name);
      if (ent.isFile()) out.push(path.relative(dir, p));
      else if (ent.isDirectory() && depth < MAX_DEPTH) await walk(p, depth + 1);
    }
  };
  await walk(dir, 1);
  return out.sort();
}

// The /api surface. deps = { config, conductor, git, usage }.
export function buildRoutes(deps) {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));
  const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : refuse('BAD_REQUEST', 400, 'expected a JSON object body'));
  const target = (b) => {
    assertWritableScope(b.scope);
    return { scope: b.scope, project: b.scope === 'project' ? b.project : undefined, name: b.name };
  };

  const toggleTarget = (b) => {
    assertToggleScope(b.scope);
    return { scope: b.scope, project: b.scope === 'project' ? b.project : undefined, name: b.name };
  };

  r.get('/health', (req, res) => res.json({ ok: true }));

  r.get('/inventory', wrap(async (req, res) => res.json(await buildInventory(deps))));

  r.get('/skills/detail', wrap(async (req, res) => {
    const skill = typeof req.query.id === 'string' ? await findSkill(deps, req.query.id) : null;
    if (!skill) refuse('NOT_FOUND', 404, 'no skill with that id in the inventory');
    const bytes = await readSkillBytes(skill.path);
    const { frontmatterText, body } = parseSkillMd(bytes.toString('utf8'));
    res.json({ skill, frontmatterText, body, files: await listFiles(path.dirname(skill.path)), etag: sha256(bytes) });
  }));

  r.post('/skills/validate', wrap(async (req, res) => {
    const { dirName, frontmatterText } = body(req);
    if (typeof dirName !== 'string' || typeof frontmatterText !== 'string') refuse('BAD_REQUEST', 400, 'dirName and frontmatterText must be strings');
    const { errors, frontmatter } = validateFrontmatter(frontmatterText, dirName);
    const f = skillFields(frontmatter);
    res.json({ ok: errors.length === 0, errors, description: f.description, whenToUse: f.whenToUse, cost: costOf({ invokeName: dirName, description: f.description, whenToUse: f.whenToUse, listing: f.disableModelInvocation ? 'hidden' : 'full' }) });
  }));

  const withSkill = async (result) => ({ ...result, skill: await findSkill(deps, result.id) });

  r.post('/skills', wrap(async (req, res) => {
    const b = body(req);
    res.status(201).json(await withSkill(await createSkill(deps, { ...target(b), description: b.description, body: b.body })));
  }));

  r.put('/skills/content', wrap(async (req, res) => {
    const b = body(req);
    res.json(await withSkill(await updateSkill(deps, { ...target(b), frontmatterText: b.frontmatterText, body: b.body, baseEtag: b.baseEtag })));
  }));

  r.put('/skills/enabled', wrap(async (req, res) => {
    const b = body(req);
    res.json(await setEnabled(deps, { ...toggleTarget(b), enabled: b.enabled }));
  }));

  r.post('/skills/delete', wrap(async (req, res) => {
    res.json(await deleteSkill(deps, target(body(req))));
  }));

  r.get('/trash', wrap(async (req, res) => res.json({ entries: await listTrash(deps.config) })));

  r.post('/trash/:trashId/restore', wrap(async (req, res) => {
    res.json(await withSkill(await restoreSkill(deps, req.params.trashId)));
  }));

  r.get('/usage', wrap(async (req, res) => res.json(await deps.usage.scan())));

  r.use((req, res) => res.status(404).json({ ok: false, code: 'NOT_FOUND', message: `no route ${req.method} /api${req.path}` }));
  return r;
}
