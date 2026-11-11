import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listSkillDirs } from './walkSkills.js';
import { readAll } from './record.js';

export const SYNCED_NAMESPACE = 'anthropic-skills';

// claude.ai-synced skills: ~/.claude/skills/synced/<org>_<account>/, the bucket
// of the account signed in per ~/.claude.json. No account or bucket → none.
export async function discover({ config, warn }) {
  let account;
  try {
    account = JSON.parse(await fs.readFile(config.claudeJson, 'utf8'))?.oauthAccount;
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw new Error(`${config.claudeJson}: ${e.message}`);
  }
  if (!account?.organizationUuid || !account?.accountUuid) return [];
  const bucket = path.join(config.claudeDir, 'skills', 'synced', `${account.organizationUuid}_${account.accountUuid}`);
  const dirs = await listSkillDirs(bucket);
  return readAll(dirs, { source: 'synced', ownerKey: '~', owner: { label: 'claude.ai sync', namespace: SYNCED_NAMESPACE }, namespace: SYNCED_NAMESPACE }, warn);
}
