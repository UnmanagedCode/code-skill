import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearDuplicates, jaccard, wordSet, NEAR_DUP_THRESHOLD } from '../src/similarity.js';

const rec = (id, invokeName, description, extra = {}) => ({ id, invokeName, description, whenToUse: null, source: 'user', owner: {}, ...extra });

// Invariant: near-identical listing texts are flagged, unrelated ones are not.
test('near-identical descriptions score ≥ threshold; unrelated ones are not flagged', () => {
  const out = nearDuplicates([
    rec('a', 'pdf-a', 'Extract text and tables from PDF files, merge or split documents'),
    rec('b', 'pdf-b', 'Extract tables and text from PDF files; merge or split documents'),
    rec('c', 'deploy', 'Deploy the web service to the staging cluster'),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].a, out[0].b], ['a', 'b']);
  assert.ok(out[0].score >= NEAR_DUP_THRESHOLD);
});

test('same invokeName pairs and cross-project project pairs are skipped', () => {
  const text = 'Review pull requests for correctness bugs carefully';
  assert.deepEqual(nearDuplicates([rec('a', 'same', text), rec('b', 'same', text)]), []);
  assert.deepEqual(nearDuplicates([
    rec('a', 'x', text, { source: 'project', owner: { project: 'p1' } }),
    rec('b', 'y', text, { source: 'project', owner: { project: 'p2' } }),
  ]), []);
  assert.equal(nearDuplicates([
    rec('a', 'x', text, { source: 'project', owner: { project: 'p1' } }),
    rec('b', 'y', text, { source: 'project', owner: { project: 'p1' } }),
  ]).length, 1);
});

// Invariant: output order is deterministic (score desc, then ids).
test('ordering is score descending, then ids', () => {
  const text = 'alpha bravo charlie delta echo foxtrot';
  const out = nearDuplicates([
    rec('z', 'z', text), rec('y', 'y', text), rec('x', 'x', `${text} golf`),
  ]);
  assert.deepEqual(out.map((p) => [p.a, p.b]), [['y', 'z'], ['x', 'y'], ['x', 'z']]);
});

test('word sets drop short words and stopwords', () => {
  assert.deepEqual([...wordSet('Use the PDF skill to go')], ['pdf']);
  assert.equal(jaccard(new Set(), new Set(['a'])), 0);
});
