import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSkillDirs } from './walkSkills.js';
import { readAll } from './record.js';

export const SYNCED_NAMESPACE = 'anthropic-skills';

// The bucket folder of the account signed in per ~/.claude.json
// (~/.claude/skills/synced/<org>_<account>/), or null when no account is signed in.
export async function syncedBucket(config) {
  let account;
  try {
    account = JSON.parse(await fs.readFile(config.claudeJson, 'utf8'))?.oauthAccount;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${config.claudeJson}: ${e.message}`);
  }
  if (!account?.organizationUuid || !account?.accountUuid) return null;
  return path.join(config.claudeDir, 'skills', 'synced', `${account.organizationUuid}_${account.accountUuid}`);
}

// claude.ai-synced skills. No account or bucket → none.
export async function discover({ config, warn }) {
  const bucket = await syncedBucket(config);
  if (!bucket) return [];
  const dirs = await listSkillDirs(bucket);
  return readAll(dirs, { source: 'synced', ownerKey: '~', owner: { label: 'claude.ai sync', namespace: SYNCED_NAMESPACE }, namespace: SYNCED_NAMESPACE }, warn);
}
