import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../fsx/atomicWrite.js';
import { refuse } from '../safety/errors.js';

export const OVERRIDE_VALUES = Object.freeze(['on', 'name-only', 'user-invocable-only', 'off']);
const MAX_ATTEMPTS = 3;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const lstatOrNull = async (p) => {
  try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

// Reads a settings JSON file. A missing file is { exists:false, obj:{} }.
// → { exists, obj, text, stat }; refuses SETTINGS_UNPARSEABLE / SETTINGS_SHAPE / SYMLINK_REFUSED.
export async function readSettingsObject(file) {
  const stat = await lstatOrNull(file);
  if (!stat) return { exists: false, obj: {}, text: null, stat: null };
  if (stat.isSymbolicLink() || !stat.isFile()) refuse('SYMLINK_REFUSED', 400, `${file} is not a regular file`);
  const text = await fs.readFile(file, 'utf8');
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    refuse('SETTINGS_UNPARSEABLE', 409, `${file} is not valid JSON (${e.message}); fix it by hand first`);
  }
  if (!isPlainObject(obj)) refuse('SETTINGS_SHAPE', 409, `${file} is not a JSON object`);
  if (obj.skillOverrides !== undefined && !isPlainObject(obj.skillOverrides)) refuse('SETTINGS_SHAPE', 409, `${file}: skillOverrides is not an object`);
  return { exists: true, obj, text, stat };
}

const detectIndent = (text) => {
  const m = /^([ \t]+)\S/m.exec(text ?? '');
  return m ? m[1] : 2;
};

const sameStat = (a, b) => (a === null && b === null) || (a && b && a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino);

// Sets (or, with value undefined, deletes) exactly skillOverrides[name] in
// `file`, leaving every other key as it was. `containRoot`: the file's folder
// must really lie inside it (it is created when missing). The read-modify-write
// retries when the file changes underneath it, then refuses SETTINGS_BUSY.
// `hooks.beforeCommit` runs between the read and the final check (tests).
// → { changed: boolean }
export async function setSkillOverride(file, name, value, { containRoot, hooks = {} } = {}) {
  if (value !== undefined && !OVERRIDE_VALUES.includes(value)) throw new Error(`bad skillOverrides value ${value}`);
  const dir = path.dirname(file);
  const dirStat = await lstatOrNull(dir);
  if (dirStat?.isSymbolicLink()) refuse('SYMLINK_REFUSED', 400, `${dir} is a symlink; refusing to write through it`);
  if (!dirStat) await fs.mkdir(dir, { recursive: true });
  if (containRoot) {
    const rel = path.relative(await fs.realpath(containRoot), await fs.realpath(dir));
    if (rel.startsWith('..') || path.isAbsolute(rel)) refuse('PATH_ESCAPE', 400, `${dir} resolves outside ${containRoot}`);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { exists, obj, text, stat } = await readSettingsObject(file);
    const current = obj.skillOverrides?.[name];
    if (current === value) return { changed: false };
    if (value === undefined) {
      delete obj.skillOverrides[name];
    } else {
      if (obj.skillOverrides === undefined) obj.skillOverrides = {};
      obj.skillOverrides[name] = value;
    }
    const out = `${JSON.stringify(obj, null, exists ? detectIndent(text) : 2)}\n`;
    let raced = false;
    try {
      await writeFileAtomic(file, out, {
        beforeRename: async () => {
          if (hooks.beforeCommit) await hooks.beforeCommit(attempt);
          if (!sameStat(stat, await lstatOrNull(file))) {
            raced = true;
            throw new Error('settings file changed during write');
          }
        },
      });
      return { changed: true };
    } catch (e) {
      if (!raced) throw e;
    }
  }
  refuse('SETTINGS_BUSY', 409, `${file} kept changing while Code Skill tried to update it; try again`);
}
