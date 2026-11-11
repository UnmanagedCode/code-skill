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

const statOrNull = async (p) => {
  try { return await fs.stat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

// Reads a settings JSON file, following symlinks (as the CLI does). A missing
// file is { exists:false, obj:{} }. → { exists, obj, text, stat }
// Refuses SETTINGS_UNPARSEABLE / SETTINGS_SHAPE, or SETTINGS_SHAPE when the path isn't a file.
export async function readSettingsObject(file) {
  const stat = await statOrNull(file);
  if (!stat) return { exists: false, obj: {}, text: null, stat: null };
  if (!stat.isFile()) refuse('SETTINGS_SHAPE', 409, `${file} is not a regular file`);
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
  // A symlinked folder (e.g. ~/.claude into a dotfiles repo) is fine: containment below checks where it really is.
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (e) {
    if (e.code === 'EEXIST' || e.code === 'ENOTDIR' || e.code === 'ENOENT') refuse('SETTINGS_SHAPE', 409, `${dir} is not a usable folder (a file or a dangling symlink)`);
    throw e;
  }
  // The file itself must not be a symlink: the atomic write renames a new file over the path, which would replace the link.
  if ((await lstatOrNull(file))?.isSymbolicLink()) {
    refuse('SYMLINK_REFUSED', 409, `${file} is a symlink (for example into a dotfiles repo). Code Skill writes settings by atomically replacing the file, which would replace your link with a plain file, so it won't. ${value === undefined ? `Remove "${name}" from "skillOverrides"` : `Set "skillOverrides": {"${name}": "${value}"}`} in the file the link points to, by hand.`);
  }
  if (containRoot) {
    const rel = path.relative(await fs.realpath(containRoot), await fs.realpath(dir));
    if (rel.startsWith('..') || path.isAbsolute(rel)) refuse('PATH_ESCAPE', 400, `${dir} resolves outside ${containRoot}`);
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = await lstatOrNull(file);
    const { exists, obj, text } = await readSettingsObject(file);
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
          if (!sameStat(before, await lstatOrNull(file))) {
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
