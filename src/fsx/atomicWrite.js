import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Writes `data` to `file` through a sibling temp file: write (exclusive),
// fsync, rename. An existing file's permission bits are kept (settings files
// may be 0600); a new file gets 0644 less the umask. On any failure the temp
// file is removed and the original is untouched. `ops.rename` and
// `ops.beforeRename` exist for tests and for the settings writer's
// last-moment concurrency check.
export async function writeFileAtomic(file, data, ops = {}) {
  const rename = ops.rename ?? fs.rename;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const existing = await fs.lstat(file).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
  const mode = existing?.isFile() ? existing.mode & 0o7777 : null;
  const fh = await fs.open(tmp, 'wx', mode ?? 0o644);
  try {
    try {
      if (mode !== null) await fh.chmod(mode);
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (ops.beforeRename) await ops.beforeRename();
    await rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
