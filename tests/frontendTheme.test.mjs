import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const html = read('public/index.html');
const styles = read('public/styles.css');
const fallback = read('public/theme-fallback.css');
const manifest = JSON.parse(read('conductor.plugin.json'));

// Invariant: the host contract's head order — bridge first, fallback under the host sheet, theme-init after both.
test('index.html head order: bridge → fallback → pluginTheme → theme-init → styles → app', () => {
  const order = ['src="/pluginBridge.js"', 'href="theme-fallback.css"', 'href="/pluginTheme.css"', 'src="theme-init.js"', 'href="styles.css"', 'src="app.js"'].map((s) => html.indexOf(s));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(html.indexOf('<script') === html.indexOf('<script src="/pluginBridge.js"'), 'the bridge is the first script');
  assert.doesNotMatch(html, /src="\/(?!pluginBridge)|href="\/(?!pluginTheme)/, 'only the two host URLs are root-relative');
});

// Invariant: colours come only from the host's tokens, so the page follows cc's theme.
test('every var(--x) in styles.css is a fallback token; no colour literals', () => {
  const declared = new Set([...fallback.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = [...styles.matchAll(/var\((--[a-z0-9-]+)(\s*,)?/g)].filter((m) => !m[2]).map((m) => m[1]);
  assert.ok(used.length > 10);
  assert.deepEqual(used.filter((v) => !declared.has(v)), []);
  const literal = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(|\b(white|black|red|green|blue|gray|grey)\b(?!-)/i;
  assert.doesNotMatch(styles.replace(/\/\*[\s\S]*?\*\//g, ''), literal);
  assert.match(fallback, /@layer fallback \{/);
  assert.match(fallback, /\.dark \{/);
});

test('title, h1, manifest name and navLabel are all "Code Skill"', () => {
  assert.match(html, /<title>Code Skill<\/title>/);
  assert.match(html, /<h1>Code Skill<\/h1>/);
  assert.equal(manifest.name, 'Code Skill');
  assert.equal(manifest.frontend.navLabel, 'Code Skill');
});
