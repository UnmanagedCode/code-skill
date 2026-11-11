import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const base = { CONDUCTOR_PLUGIN_DATA_DIR: '/d', CONDUCTOR_URL: 'http://127.0.0.1:1', PROJECTS_ROOT: '/p', HOME: '/h' };

// Invariant: startup fails loudly, naming the missing host variable.
for (const name of ['CONDUCTOR_PLUGIN_DATA_DIR', 'CONDUCTOR_URL', 'PROJECTS_ROOT']) {
  test(`missing ${name} throws a message naming it`, () => {
    const env = { ...base };
    delete env[name];
    assert.throws(() => loadConfig(env), new RegExp(name));
  });
}

// Invariant: ~/.claude resolves exactly like cc and the CLI (CLAUDE_CONFIG_DIR, else HOME/.claude).
test('claudeDir is CLAUDE_CONFIG_DIR, else HOME/.claude', () => {
  assert.equal(loadConfig(base).claudeDir, path.join('/h', '.claude'));
  assert.equal(loadConfig(base).claudeJson, path.join('/h', '.claude.json'));
  const c = loadConfig({ ...base, CLAUDE_CONFIG_DIR: '/cfg' });
  assert.equal(c.claudeDir, '/cfg');
  assert.equal(c.claudeJson, path.join('/cfg', '.claude.json'));
});

// Invariant: cc's store and core plugin paths derive from the host variables.
test('storeDir and coreDir derive from PROJECTS_ROOT and CONDUCTOR_PROJECT_DIR', () => {
  assert.equal(loadConfig(base).storeDir, path.join('/p', '.code-conductor'));
  assert.equal(loadConfig(base).coreDir, null);
  assert.equal(loadConfig({ ...base, CONDUCTOR_PROJECT_DIR: '/cc' }).coreDir, path.join('/cc', 'claude-plugin'));
  assert.equal(loadConfig({ ...base, PORT: '9001' }).port, 9001);
  assert.equal(loadConfig(base).port, 7420);
});
