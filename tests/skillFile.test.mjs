import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillMd, skillFields, validateFrontmatter, composeSkillMd, buildSkillMd } from '../src/skillFile.js';

// Invariant: real-world frontmatter styles (F15) parse to the same fields.
test('double-quoted, single-quoted, folded multi-line and flow-list frontmatter parse', () => {
  const dq = parseSkillMd('---\nname: a\ndescription: "Use when: x"\n---\n\nbody');
  assert.equal(dq.frontmatter.description, 'Use when: x');
  assert.equal(dq.body, 'body');
  const sq = parseSkillMd("---\nname: b\ndescription: 'It''s here'\n---\nbody");
  assert.equal(sq.frontmatter.description, "It's here");
  const folded = parseSkillMd('---\nname: c\ndescription: Use this skill\n  when the user\n  asks for c.\n---\n');
  assert.equal(folded.frontmatter.description, 'Use this skill when the user asks for c.');
  const flow = parseSkillMd('---\nname: d\ndescription: d\nallowed-tools: [\n  Read,\n  Bash\n]\n---\n');
  assert.deepEqual(flow.frontmatter['allowed-tools'], ['Read', 'Bash']);
  assert.deepEqual([dq, sq, folded, flow].map((r) => r.errors.length), [0, 0, 0, 0]);
});

// Invariant: broken foreign files are reported, never thrown.
test('missing, unclosed or invalid frontmatter becomes errors[]', () => {
  assert.match(parseSkillMd('# just markdown').errors[0], /missing/);
  assert.match(parseSkillMd('---\nname: x\n').errors[0], /not closed/);
  assert.equal(parseSkillMd('---\nname: [x\n---\n').errors.length, 1);
  assert.match(parseSkillMd('---\n- a\n- b\n---\n').errors[0], /mapping/);
});

test('skillFields normalises flags', () => {
  const f = skillFields({ description: 'x', 'disable-model-invocation': true, 'user-invocable': false, when_to_use: 'w' });
  assert.deepEqual(f, { name: null, description: 'x', whenToUse: 'w', disableModelInvocation: true, userInvocable: false });
});

// Invariant: content Code Skill writes is checked strictly.
test('validateFrontmatter enforces name = folder, non-empty description, typed flags', () => {
  assert.deepEqual(validateFrontmatter('name: a\ndescription: d', 'a').errors, []);
  assert.match(validateFrontmatter('name: b\ndescription: d', 'a').errors[0], /folder name/);
  assert.match(validateFrontmatter('name: a', 'a').errors[0], /description/);
  assert.match(validateFrontmatter('description: d\nuser-invocable: "no"', 'a').errors[0], /user-invocable/);
  assert.match(validateFrontmatter('description: d\nwhen_to_use: 3', 'a').errors[0], /when_to_use/);
});

// Invariant: an edit writes the frontmatter text verbatim and round-trips through the parser.
test('compose keeps frontmatter verbatim and round-trips', () => {
  const fm = '# a comment\nname: a\ndescription: d  # trailing';
  const text = composeSkillMd(fm, 'Body\n');
  assert.ok(text.includes(fm));
  const back = parseSkillMd(text);
  assert.equal(back.frontmatterText, fm);
  assert.equal(back.body, 'Body\n');
  const built = parseSkillMd(buildSkillMd({ name: 'n', description: 'has: colon' }, 'b'));
  assert.deepEqual(built.frontmatter, { name: 'n', description: 'has: colon' });
});
