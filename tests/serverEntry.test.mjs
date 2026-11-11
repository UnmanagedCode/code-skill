import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENTRY = fileURLToPath(new URL('../server.js', import.meta.url));
// No host variables: a start attempt fails loudly, so "exit 0" proves nothing started.
const ENV = { PATH: process.env.PATH };

// Invariant: server.js starts the plugin only when run directly; importing it has no side effects.
test('importing server.js does not start it; running it directly does', () => {
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.env.ENTRY);'], { env: { ...ENV, ENTRY }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(imported.status, 0, imported.stderr);
  const direct = spawnSync(process.execPath, [ENTRY], { env: ENV, encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /CONDUCTOR_PLUGIN_DATA_DIR is not set/);
});
