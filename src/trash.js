import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeFileAtomic } from './fsx/atomicWrite.js';
import { refuse } from './safety/errors.js';

// Deleted skills, kept under <dataDir>/trash/<trashId>/{skill/, meta.json}.
export const TRASH_ID_RE = /^\d+-[0-9a-f]{8}$/;

const trashRoot = (config) => path.join(config.dataDir, 'trash');

// Moves a directory; across filesystems (EXDEV) it copies, then removes the source.
export async function moveDir(src, dst, { rename = fs.rename } = {}) {
  try {
    await rename(src, dst);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    await fs.cp(src, dst, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    await fs.rm(src, { recursive: true });
  }
}

// → trashId
export async function moveToTrash(config, { scope, project, name, dir }, ops = {}) {
  const trashId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const entry = path.join(trashRoot(config), trashId);
  await fs.mkdir(entry, { recursive: true });
  try {
    await moveDir(dir, path.join(entry, 'skill'), ops);
  } catch (e) {
    await fs.rm(entry, { recursive: true, force: true });
    throw e;
  }
  const meta = { trashId, scope, project: project ?? null, name, originalPath: dir, deletedAt: new Date().toISOString() };
  await writeFileAtomic(path.join(entry, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return trashId;
}

const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

const lstatOrNull = async (p) => {
  try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
};

// Checks an entry's shape before anything trusts it: the entry and its skill/
// folder are real directories (no symlinks) really inside the trash, meta.json
// a regular file holding a JSON object. → { meta, entry, skillDir }
// Refuses SYMLINK_REFUSED for a symlink anywhere in it, NOT_FOUND for anything else malformed.
export async function inspectEntry(config, trashId) {
  if (typeof trashId !== 'string' || !TRASH_ID_RE.test(trashId)) refuse('NOT_FOUND', 404, 'no such trash entry');
  const root = await fs.realpath(trashRoot(config)).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  if (!root) refuse('NOT_FOUND', 404, 'no such trash entry');
  const entry = path.join(root, trashId);
  const skillDir = path.join(entry, 'skill');
  const metaFile = path.join(entry, 'meta.json');
  for (const [p, kind] of [[entry, 'dir'], [skillDir, 'dir'], [metaFile, 'file']]) {
    const st = await lstatOrNull(p);
    if (!st) refuse('NOT_FOUND', 404, `trash entry ${trashId} is incomplete`);
    if (st.isSymbolicLink()) refuse('SYMLINK_REFUSED', 400, `trash entry ${trashId} contains a symlink (${path.basename(p)}); refusing to restore it`);
    if (kind === 'dir' ? !st.isDirectory() : !st.isFile()) refuse('NOT_FOUND', 404, `trash entry ${trashId} is malformed`);
    if (!inside(root, await fs.realpath(p))) refuse('SYMLINK_REFUSED', 400, `trash entry ${trashId} resolves outside the trash`);
  }
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(metaFile, 'utf8'));
  } catch {
    refuse('NOT_FOUND', 404, `trash entry ${trashId} has an unreadable meta.json`);
  }
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta) || typeof meta.name !== 'string' || typeof meta.scope !== 'string') {
    refuse('NOT_FOUND', 404, `trash entry ${trashId} has a malformed meta.json`);
  }
  return { meta: { ...meta, trashId }, entry, skillDir };
}

// Newest first. An entry that fails inspectEntry is logged and left out.
export async function listTrash(config) {
  let ids;
  try {
    ids = (await fs.readdir(trashRoot(config))).filter((n) => TRASH_ID_RE.test(n));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  const out = [];
  for (const id of ids) {
    try {
      out.push((await inspectEntry(config, id)).meta);
    } catch (e) {
      console.error(`code-skill: trash entry ${id} skipped: ${e.message}`);
    }
  }
  return out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)) || b.trashId.localeCompare(a.trashId));
}

// Moves an inspected entry's skill folder to `dst`, then drops the entry.
export async function takeFromTrash({ entry, skillDir }, dst, ops = {}) {
  await moveDir(skillDir, dst, ops);
  await fs.rm(entry, { recursive: true, force: true });
}
