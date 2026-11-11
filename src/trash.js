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

// Newest first. An entry with an unreadable meta.json is logged and left out.
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
      out.push(JSON.parse(await fs.readFile(path.join(trashRoot(config), id, 'meta.json'), 'utf8')));
    } catch (e) {
      console.error(`code-skill: trash entry ${id} unreadable: ${e.message}`);
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.trashId.localeCompare(a.trashId));
}

export async function readTrashEntry(config, trashId) {
  if (typeof trashId !== 'string' || !TRASH_ID_RE.test(trashId)) refuse('NOT_FOUND', 404, 'no such trash entry');
  try {
    return JSON.parse(await fs.readFile(path.join(trashRoot(config), trashId, 'meta.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') refuse('NOT_FOUND', 404, 'no such trash entry');
    throw e;
  }
}

// Moves the entry's skill folder to `dst`, then drops the entry.
export async function takeFromTrash(config, trashId, dst, ops = {}) {
  const entry = path.join(trashRoot(config), trashId);
  await moveDir(path.join(entry, 'skill'), dst, ops);
  await fs.rm(entry, { recursive: true, force: true });
}
