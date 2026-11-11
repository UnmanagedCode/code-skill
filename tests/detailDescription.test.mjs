import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeDoc, walk } from './fixtures/fakeDoc.mjs';

// The page is served with shared/ mounted at /shared/, so views import '../shared/x.js'
// (not resolvable on disk under public/). Map that one prefix back to the repo's shared/.
const SHARED = fileURLToPath(new URL('../shared/', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    const m = /^\.\.\/shared\/(.+)$/.exec(specifier);
    return m ? next(pathToFileURL(SHARED + m[1]).href, context) : next(specifier, context);
  },
});

const HOSTILE = '<img src=x onerror=alert(1)> and **not bold**';
const WHEN = '<script>alert(2)</script> when asked';
const COST = { tokens: 42, chars: 168, truncated: false };

const skill = (over) => ({
  id: 'x', invokeName: 'x', dirName: 'x', path: '/p/x/SKILL.md', source: 'cc-core', writable: false,
  owner: { label: 'o' }, cost: COST, warnings: [], description: HOSTILE, whenToUse: WHEN, files: [],
  override: { effective: 'on', layers: [], lockedByPolicy: false }, toggleable: true, ...over,
});

// Renders the real pane (editor.js) on a fake document, with canned API answers.
async function render(sk, validate) {
  const { doc } = fakeDoc();
  globalThis.document = doc;
  const { renderPane } = await import('../public/views/editor.js');
  globalThis.fetch = async (url) => {
    const body = url.endsWith('skills/validate') ? validate : { skill: sk, frontmatterText: 'name: x', body: '# BODY', files: [], etag: 'e' };
    return { ok: true, json: async () => body };
  };
  const pane = doc.createElement('aside');
  const app = { state: { pane: { kind: 'skill', id: 'x' }, inventory: { skills: [] }, usage: null }, closePane() {}, notify() {} };
  await renderPane(app, pane);
  await new Promise((r) => setImmediate(r));
  return pane;
}

// The description section's direct text, and whether any element was built from it.
const sectionOf = (pane) => walk(pane).find((n) => n.className === 'sub description');
const textsOf = (el) => walk(el).filter((n) => n.nodeType === 3).map((n) => n.data);

// Invariant: the detail view shows the description and when_to_use only as verbatim
// text nodes (markup in them builds no element), above the body, for read-only and
// writable skills alike; a writable skill's block follows the validate response.
test('read-only detail renders description and when_to_use as text, above the preview', async () => {
  const pane = await render(skill({}));
  const sec = sectionOf(pane);
  assert.ok(sec, 'description section present');
  assert.ok(textsOf(sec).includes(HOSTILE) && textsOf(sec).includes(WHEN));
  assert.deepEqual(walk(sec).map((n) => n.tagName).filter(Boolean).filter((t) => !['SECTION', 'H3', 'P'].includes(t)), []);
  assert.ok(textsOf(sec).some((t) => t.startsWith('Listing: ') && t.includes('42')));
  const order = walk(pane).filter((n) => n === sec || n.className === 'preview');
  assert.equal(order[0], sec, 'description precedes the preview');
});

test('writable detail renders description as text and follows live validate results', async () => {
  const live = { ok: true, errors: [], description: 'edited <b>live</b>', whenToUse: null, cost: { tokens: 7, chars: 28, truncated: false } };
  const pane = await render(skill({ source: 'user', writable: true }), live);
  const sec = sectionOf(pane);
  assert.ok(textsOf(sec).includes('edited <b>live</b>'), 'shows the live frontmatter description');
  assert.ok(!textsOf(sec).includes(HOSTILE), 'old description replaced');
  assert.ok(!walk(sec).some((n) => n.tagName === 'B'), 'no element built from the text');
  assert.ok(!textsOf(sec).includes('When to use'), 'when_to_use hidden once removed');
});
