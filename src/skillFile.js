import YAML from 'yaml';

// SKILL.md = "---\n<yaml>\n---\n" + markdown body. Reading is lenient (foreign
// skills): problems land in `errors`, never a throw. Writing validates strictly.

const OPEN_RE = /^---[ \t]*\r?\n/;
const CLOSE_RE = /^---[ \t]*$/m;

// → { frontmatterText, frontmatter, body, errors[] }
export function parseSkillMd(text) {
  const errors = [];
  const open = OPEN_RE.exec(text);
  if (!open) return { frontmatterText: '', frontmatter: {}, body: text, errors: ['frontmatter: missing (SKILL.md must start with ---)'] };
  const rest = text.slice(open[0].length);
  const close = CLOSE_RE.exec(rest);
  if (!close) return { frontmatterText: rest, frontmatter: {}, body: '', errors: ['frontmatter: not closed (no line with ---)'] };
  const frontmatterText = rest.slice(0, close.index).replace(/\r?\n$/, '');
  // Drop the closing line's newline, then one separating blank line.
  const body = rest.slice(close.index + close[0].length).replace(/^\r?\n/, '').replace(/^\r?\n/, '');
  let frontmatter = {};
  try {
    const parsed = YAML.parse(frontmatterText, { prettyErrors: false });
    if (parsed === null || parsed === undefined) frontmatter = {};
    else if (typeof parsed !== 'object' || Array.isArray(parsed)) errors.push('frontmatter: must be a YAML mapping');
    else frontmatter = parsed;
  } catch (e) {
    errors.push(`frontmatter: ${firstLine(e.message)}`);
  }
  return { frontmatterText, frontmatter, body, errors };
}

const firstLine = (s) => String(s).split('\n')[0];

// The fields Code Skill reads from frontmatter, normalised for display/cost.
export function skillFields(frontmatter) {
  const str = (v) => (v === undefined || v === null ? null : typeof v === 'string' ? v : String(v));
  return {
    name: str(frontmatter.name),
    description: str(frontmatter.description) ?? '',
    whenToUse: str(frontmatter.when_to_use),
    disableModelInvocation: frontmatter['disable-model-invocation'] === true,
    userInvocable: frontmatter['user-invocable'] !== false,
  };
}

// Strict check for content Code Skill writes. → { errors[], frontmatter }
export function validateFrontmatter(frontmatterText, dirName) {
  const { frontmatter, errors } = parseSkillMd(`---\n${frontmatterText}\n---\n`);
  if (errors.length) return { errors, frontmatter };
  if (frontmatter.name !== undefined && frontmatter.name !== dirName) errors.push(`name must equal the folder name "${dirName}"`);
  if (typeof frontmatter.description !== 'string' || frontmatter.description.trim() === '') errors.push('description must be a non-empty string');
  if (frontmatter.when_to_use !== undefined && typeof frontmatter.when_to_use !== 'string') errors.push('when_to_use must be a string');
  for (const k of ['disable-model-invocation', 'user-invocable']) {
    if (frontmatter[k] !== undefined && typeof frontmatter[k] !== 'boolean') errors.push(`${k} must be true or false`);
  }
  return { errors, frontmatter };
}

// The bytes written for an edit: the user's frontmatter text verbatim.
export function composeSkillMd(frontmatterText, body) {
  return `---\n${frontmatterText.trimEnd()}\n---\n\n${body}`;
}

// A new skill's SKILL.md.
export function buildSkillMd({ name, description }, body) {
  return composeSkillMd(YAML.stringify({ name, description }), body);
}
