import { promises as fs } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeFileAtomic } from '../fsx/atomicWrite.js';
import { roots, listTranscripts } from './transcriptRoots.js';
import { scanFileFrom } from './scanFile.js';

const CACHE_VERSION = 1;

// Skill usage from session transcripts, scanned incrementally: the cache in
// <dataDir>/usage-cache.json remembers each file's read offset and every call
// by tool_use id, so a refresh reads only appended bytes and calls survive the
// CLI deleting old transcripts. Concurrent scan() calls share one scan.
export function createUsageIndex(config) {
  const cacheFile = path.join(config.dataDir, 'usage-cache.json');
  let running = null;

  const loadCache = async () => {
    try {
      const c = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      if (c?.version === CACHE_VERSION && c.files && c.calls) return c;
      console.error(`code-skill: ${cacheFile} has an unknown shape; rescanning all transcripts`);
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`code-skill: ${cacheFile} unreadable (${e.message}); rescanning all transcripts`);
    }
    return { version: CACHE_VERSION, files: {}, calls: {} };
  };

  const dropCallsOf = (cache, file) => {
    for (const [id, c] of Object.entries(cache.calls)) if (c.file === file) delete cache.calls[id];
  };

  async function runScan() {
    const t0 = performance.now();
    const cache = await loadCache();
    const files = await listTranscripts(await roots(config));
    const present = new Set(files);
    let filesRead = 0;
    let bytesRead = 0;
    let malformedLines = 0;
    for (const file of files) {
      let st;
      try {
        st = await fs.stat(file);
      } catch (e) {
        if (e.code === 'ENOENT') { present.delete(file); continue; }
        throw e;
      }
      const prev = cache.files[file];
      if (prev && !prev.gone && prev.ino === st.ino && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;
      let offset = 0;
      if (prev && !prev.gone && prev.ino === st.ino && st.size >= prev.offset) offset = prev.offset;
      else dropCallsOf(cache, file);
      const r = await scanFileFrom(file, offset);
      filesRead++;
      bytesRead += r.bytesRead;
      malformedLines += r.malformed;
      for (const c of r.calls) cache.calls[c.id] = { skill: c.skill, ts: c.ts, sessionId: c.sessionId, file };
      cache.files[file] = { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, offset: r.newOffset };
    }
    for (const [file, entry] of Object.entries(cache.files)) if (!present.has(file)) entry.gone = true;
    await fs.mkdir(config.dataDir, { recursive: true });
    await writeFileAtomic(cacheFile, JSON.stringify(cache));
    return {
      skills: aggregate(cache.calls),
      scan: { files: files.length, filesRead, bytesRead, malformedLines, ms: Math.round(performance.now() - t0), at: new Date().toISOString() },
    };
  }

  return {
    scan() {
      running ??= runScan().finally(() => { running = null; });
      return running;
    },
  };
}

// Calls grouped by invoke name: count, latest timestamp, distinct sessions; most used first.
export function aggregate(calls) {
  const by = new Map();
  for (const c of Object.values(calls)) {
    let s = by.get(c.skill);
    if (!s) by.set(c.skill, (s = { invokeName: c.skill, count: 0, lastUsedAt: null, sessionIds: new Set() }));
    s.count++;
    if (c.ts && (!s.lastUsedAt || c.ts > s.lastUsedAt)) s.lastUsedAt = c.ts;
    if (c.sessionId) s.sessionIds.add(c.sessionId);
  }
  return [...by.values()]
    .map(({ sessionIds, ...s }) => ({ ...s, sessions: sessionIds.size }))
    .sort((a, b) => b.count - a.count || a.invokeName.localeCompare(b.invokeName));
}
