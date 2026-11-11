import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Writes `data` to `file` through a sibling temp file: write (exclusive),
// fsync, rename. On any failure the temp file is removed and the original is
// untouched. `ops.rename` and `ops.beforeRename` exist for tests and for the
// settings writer's last-moment concurrency check.
export async function writeFileAtomic(file, data, ops = {}) {
  const rename = ops.rename ?? fs.rename;
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  const fh = await fs.open(tmp, 'wx', 0o644);
  try {
    try {
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
