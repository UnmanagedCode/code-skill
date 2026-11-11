import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { boot } from './helpers.mjs';
import { CSP } from '../src/http/securityHeaders.js';

// Invariant: every response carries the CSP and nosniff, including 404s and errors.
test('CSP + nosniff on page, asset, shared, API, 404 and error responses', async (t) => {
  const app = await boot(t);
  for (const route of ['/', '/app.js', '/styles.css', '/views/inventory.js', '/shared/cost.js', '/api/health', '/nope', '/api/inventory?x']) {
    const res = await fetch(app.url + route);
    assert.equal(res.headers.get('content-security-policy'), CSP, route);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', route);
  }
  const err = await fetch(`${app.url}/api/skills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(err.headers.get('content-security-policy'), CSP);
  assert.doesNotMatch(CSP, /unsafe-inline/);
});

test('the UI and shared modules are served with no-store', async (t) => {
  const app = await boot(t);
  const page = await fetch(`${app.url}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const shared = await fetch(`${app.url}/shared/names.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /javascript/);
});

// Invariant: static serving can't leak files or fake the host's URLs standalone.
test('host URLs 404 standalone; traversal, source maps and other files → 404', async (t) => {
  const app = await boot(t);
  // Raw request paths: fetch() would normalise the dot segments away client-side.
  const rawStatus = (route) => new Promise((resolve, reject) => {
    const { hostname, port } = new URL(app.url);
    http.get({ hostname, port, path: route }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  for (const route of ['/pluginBridge.js', '/pluginTheme.css', '/../package.json', '/%2e%2e/package.json', '/shared/../src/app.js', '/shared/%2e%2e%2fsrc%2fapp.js', '/x.map', '/app.js.map', '/server.js', '/package.json', '/src/app.js', '/views/../app.js', '/views/%2e%2e/app.js', '/views/..%2fapp.js', '/index.html.bak', '/shared/../package.json']) {
    assert.equal(await rawStatus(route), 404, route);
  }
});
