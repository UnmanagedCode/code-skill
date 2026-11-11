// Skill-name rules for the folders Code Skill creates. Served to the browser
// as /shared/names.js, so the editor's live check and the server's refusal are
// the same code.

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// Folder names Claude Code reserves under a skills root (claude.ai sync).
export const RESERVED_NAMES = Object.freeze(['synced', 'anthropic-skills']);

// → { ok: true } | { ok: false, code: 'INVALID_NAME' | 'RESERVED_NAME', message }
export function validateSkillName(name) {
  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    return { ok: false, code: 'INVALID_NAME', message: 'Use 1–64 lowercase letters, digits and hyphens, starting with a letter or digit.' };
  }
  if (RESERVED_NAMES.includes(name)) {
    return { ok: false, code: 'RESERVED_NAME', message: `"${name}" is reserved by Claude Code.` };
  }
  return { ok: true };
}
