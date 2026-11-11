import { promises as fs } from 'node:fs';
import path from 'node:path';

// Where session transcripts live: the host's <claudeDir>/projects, plus each
// remote-backed session's private <store>/claude-config/*/.claude/projects.
export async function roots(config) {
  const out = [path.join(config.claudeDir, 'projects')];
  const farms = path.join(config.storeDir, 'claude-config');
  try {
    for (const d of (await fs.readdir(farms, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      out.push(path.join(farms, d, '.claude', 'projects'));
    }
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return out;
}

const MAX_DEPTH = 4;

// Every *.jsonl under the roots (symlinked folders not followed; a root reached twice is walked once).
export async function listTranscripts(rootList) {
  const files = [];
  const seenRoots = new Set();
  const walk = async (dir, depth) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EACCES') return;
      throw e;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory() && depth < MAX_DEPTH) await walk(p, depth + 1);
      else if (ent.isFile() && ent.name.endsWith('.jsonl')) files.push(p);
    }
  };
  for (const root of rootList) {
    let real;
    try {
      real = await fs.realpath(root);
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    if (seenRoots.has(real)) continue;
    seenRoots.add(real);
    await walk(root, 0);
  }
  return files.sort();
}
