import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { makeRoots } from './fixtures/roots.mjs';
import { skillCall, blobCopy, skillResult, commandRecord, MALFORMED, lines } from './fixtures/transcripts.mjs';
import { createUsageIndex } from '../src/usage/usageIndex.js';

const T1 = 'home/.claude/projects/-w-a/sess-1.jsonl';
const SUB = 'home/.claude/projects/-w-a/sess-1/subagents/agent-1.jsonl';
const REMOTE = 'projects/.code-conductor/claude-config/box1/.claude/projects/-w-b/sess-9.jsonl';

async function index(t, files) {
  const roots = await makeRoots(t, { files });
  const config = roots.config('http://127.0.0.1:1');
  return { roots, config, usage: createUsageIndex(config) };
}
const byName = (res) => Object.fromEntries(res.skills.map((s) => [s.invokeName, s]));

// Invariant: one Skill tool call counts once, from assistant records only (F12).
test('counts assistant Skill tool_use once; blob copies, results and slash commands ignored', async (t) => {
  const { usage } = await index(t, {
    [T1]: lines(
      skillCall({ id: 'tu1', skill: 'review', ts: '2026-11-01T10:00:00.000Z' }),
      blobCopy({ id: 'tu1', skill: 'review' }),
      skillResult({ id: 'tu1', skill: 'review' }),
      skillCall({ id: 'tu2', skill: 'review', ts: '2026-11-03T10:00:00.000Z', sessionId: 'sess-2' }),
      commandRecord('clear'),
      MALFORMED,
    ),
    [SUB]: lines(skillCall({ id: 'tu3', skill: 'plugin:x', ts: '2026-11-02T00:00:00.000Z' })),
    [REMOTE]: lines(skillCall({ id: 'tu4', skill: 'review', ts: '2026-11-02T00:00:00.000Z', sessionId: 'sess-9' })),
  });
  const res = await usage.scan();
  assert.deepEqual(byName(res).review, { invokeName: 'review', count: 3, lastUsedAt: '2026-11-03T10:00:00.000Z', sessions: 3 });
  assert.equal(byName(res)['plugin:x'].count, 1, 'subagent transcript scanned');
  assert.equal(res.skills.length, 2);
  assert.equal(res.scan.files, 3);
  assert.equal(res.scan.malformedLines, 1);
});

// Invariant: a refresh reads only new bytes; history survives transcript cleanup.
test('unchanged files are not re-read; appends read only the new bytes', async (t) => {
  const { usage, roots } = await index(t, { [T1]: lines(skillCall({ id: 'a', skill: 's' })) });
  const first = await usage.scan();
  assert.equal(first.scan.filesRead, 1);
  const second = await usage.scan();
  assert.equal(second.scan.filesRead, 0);
  assert.equal(second.scan.bytesRead, 0);
  const extra = lines(skillCall({ id: 'b', skill: 's' }));
  await fs.appendFile(roots.p(T1), extra);
  const third = await usage.scan();
  assert.equal(third.scan.bytesRead, Buffer.byteLength(extra));
  assert.equal(byName(third).s.count, 2);
});

test('a partial trailing line counts once, only when completed', async (t) => {
  const full = skillCall({ id: 'p', skill: 's' });
  const { usage, roots } = await index(t, { [T1]: full.slice(0, 40) });
  assert.deepEqual((await usage.scan()).skills, []);
  await fs.appendFile(roots.p(T1), `${full.slice(40)}\n`);
  assert.equal(byName(await usage.scan()).s.count, 1);
  await fs.appendFile(roots.p(T1), lines(commandRecord('x')));
  assert.equal(byName(await usage.scan()).s.count, 1);
});

test('a truncated or replaced file is rescanned without double counting', async (t) => {
  const { usage, roots } = await index(t, { [T1]: lines(skillCall({ id: 'a', skill: 's' }), skillCall({ id: 'b', skill: 's' })) });
  assert.equal(byName(await usage.scan()).s.count, 2);
  await fs.writeFile(roots.p(T1), lines(skillCall({ id: 'c', skill: 't' })));
  const res = await usage.scan();
  assert.equal(byName(res).s, undefined, 'calls of the replaced content dropped');
  assert.equal(byName(res).t.count, 1);
});

test('a deleted transcript keeps its calls; the cache lives in the data dir', async (t) => {
  const { usage, roots, config } = await index(t, { [T1]: lines(skillCall({ id: 'a', skill: 's' })) });
  await usage.scan();
  await fs.rm(roots.p(T1));
  const res = await usage.scan();
  assert.equal(byName(res).s.count, 1);
  assert.equal(res.scan.files, 0);
  const cache = JSON.parse(await fs.readFile(`${config.dataDir}/usage-cache.json`, 'utf8'));
  assert.equal(cache.files[roots.p(T1)].gone, true);
  // A fresh index (a plugin restart) reads the same history from the cache.
  assert.equal(byName(await createUsageIndex(config).scan()).s.count, 1);
});

test('concurrent scans share one run', async (t) => {
  const { usage } = await index(t, { [T1]: lines(skillCall({ id: 'a', skill: 's' })) });
  const [a, b] = await Promise.all([usage.scan(), usage.scan()]);
  assert.equal(a, b);
});

test('a corrupt cache is rebuilt from the transcripts', async (t) => {
  const { usage } = await index(t, { [T1]: lines(skillCall({ id: 'a', skill: 's' })), 'data/usage-cache.json': '{oops' });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    assert.equal(byName(await usage.scan()).s.count, 1);
  } finally {
    console.error = orig;
  }
  assert.match(errors.join(), /unreadable/);
});
