import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../conductor.plugin.json', import.meta.url)));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

// Copied from code-conductor src/plugins/manifest.ts (KNOWN_TOP_KEYS and validateFrontend's key list).
const KNOWN_TOP_KEYS = ['id', 'name', 'version', 'pluginApi', 'backend', 'frontend', 'mcp', 'conventions', 'roles', 'playbooks', 'claudePlugin', 'runCodeModule', 'menuItems'];
const FRONTEND_KEYS = ['path', 'navLabel', 'keepAlive', 'icon'];
const BACKEND_KEYS = ['start', 'healthPath', 'readyWhen'];

// Invariant: the manifest is one cc accepts, for a UI-only plugin with no MCP.
test('manifest keys are known to cc; no mcp', () => {
  for (const k of Object.keys(manifest)) assert.ok(KNOWN_TOP_KEYS.includes(k), k);
  for (const k of Object.keys(manifest.frontend)) assert.ok(FRONTEND_KEYS.includes(k), k);
  for (const k of Object.keys(manifest.backend)) assert.ok(BACKEND_KEYS.includes(k), k);
  assert.equal(manifest.mcp, undefined);
  assert.equal(manifest.backend.healthPath, '/api/health');
});

test('id matches cc rules and the package name; runtime deps are express and yaml only', () => {
  assert.match(manifest.id, /^[a-z][a-z0-9-]*$/);
  assert.equal(manifest.id, pkg.name);
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['express', 'yaml']);
  assert.equal(pkg.type, 'module');
});
