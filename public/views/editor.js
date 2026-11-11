// The side pane: a skill's detail (read-only sources) or editor (user and
// project skills), and the new-skill form.
import { h, mount } from '../dom.js';
import { api } from '../api.js';
import { parseMarkdown, renderMarkdown } from '../markdown.js';
import { costOf } from '../../shared/cost.js';
import { validateSkillName } from '../../shared/names.js';
import { num, tokens, SOURCE_LABELS } from '../format.js';
import { notice, pickupNotice, gitNotice, projectWriteNotice, TOGGLE_NOTICE } from '../notices.js';
import { scopeOf, usageMap } from './inventory.js';
import { confirmDialog } from './confirm.js';
import { restore } from './trash.js';

const VALIDATE_DEBOUNCE_MS = 400;
const EVALS_SKILL = 'anthropic-skills:skill-creator';

const field = (label, control, hint) => h('label', { className: 'field' }, h('span', { className: 'field-label' }, label), control, hint ?? null);

function header(app, title, sub) {
  return h('div', { className: 'pane-head' },
    h('div', {}, h('h2', {}, title), sub ?? null),
    h('button', { type: 'button', className: 'btn btn-ghost', ariaLabel: 'Close', onClick: () => app.closePane() }, '✕'));
}

function preview(body) {
  return h('div', { className: 'preview' }, renderMarkdown(parseMarkdown(body), document));
}

function evalsBox(app, skill) {
  if (!app.state.inventory?.skills.some((s) => s.invokeName === EVALS_SKILL)) return null;
  const prompt = `Use the ${EVALS_SKILL} skill to run evals on the skill at ${skill.path}`;
  const input = h('input', { type: 'text', className: 'input', readOnly: true, value: prompt, ariaLabel: 'Eval prompt' });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      app.notify('info', 'Eval prompt copied. Paste it into a session.');
    } catch {
      input.select();
      app.notify('info', 'Prompt selected: press Ctrl+C (⌘C) to copy it.');
    }
  };
  return h('section', { className: 'sub' }, h('h3', {}, 'Run evals with skill-creator'), h('div', { className: 'row' }, input, h('button', { type: 'button', className: 'btn', onClick: copy }, 'Copy')));
}

function overrideSummary(skill) {
  const o = skill.override;
  if (!o) return null;
  const lines = o.layers.map((l) => `${l.value} in ${l.file} (${l.layer})`);
  if (o.lockedByPolicy) lines.push('Managed policy sets this skill; it cannot be changed here.');
  for (const p of o.otherProjects ?? []) lines.push(`Project ${p.project} sets it ${p.value} (${p.layer}) for sessions there.`);
  return h('div', { className: 'sub' }, h('p', {}, `State: ${o.effective}`), lines.length ? h('ul', { className: 'plain' }, lines.map((l) => h('li', {}, l))) : null);
}

function warningsList(skill) {
  return skill.warnings.length ? notice('warn', h('ul', { className: 'plain' }, skill.warnings.map((w) => h('li', {}, w)))) : null;
}

function meta(app, skill) {
  const u = usageMap(app.state.usage)?.get(skill.invokeName);
  return h('div', { className: 'meta' },
    h('span', { className: `src src-${skill.source}` }, SOURCE_LABELS[skill.source]),
    h('span', {}, skill.writable ? skill.owner.label : `owned by ${skill.owner.label}`),
    h('span', {}, `${tokens(skill.cost.tokens)} tokens in the listing`),
    h('span', {}, u ? `${num(u.count)} uses` : app.state.usage ? 'never fired' : ''));
}

function readOnlyView(app, pane, d) {
  const { skill } = d;
  const sessions = skill.sessions ? h('section', { className: 'sub' }, h('h3', {}, `Carried by ${skill.sessions.length} session${skill.sessions.length > 1 ? 's' : ''}`),
    h('ul', { className: 'plain' }, skill.sessions.map((s) => h('li', {}, `${s.label}${s.status ? ` (${s.status})` : ''}`)))) : null;
  mount(pane,
    header(app, skill.invokeName, meta(app, skill)),
    h('p', { className: 'badge badge-block' }, `Read-only: owned by ${skill.owner.label}`),
    notice('info', pickupNotice(skill)),
    warningsList(skill),
    h('p', { className: 'muted path' }, skill.path),
    sessions,
    h('section', { className: 'sub' }, h('h3', {}, 'Preview'), preview(d.body)),
    h('section', { className: 'sub' }, h('h3', {}, 'SKILL.md'), h('pre', { className: 'raw' }, `---\n${d.frontmatterText}\n---\n\n${d.body}`)),
    h('section', { className: 'sub' }, h('h3', {}, 'Files'), h('ul', { className: 'plain mono' }, d.files.map((f) => h('li', {}, f)))),
    evalsBox(app, skill));
}

function editableView(app, pane, d) {
  const { skill } = d;
  let etag = d.etag;
  const target = { ...scopeOf(skill), name: skill.dirName };
  const project = skill.source === 'project' ? skill.owner.project : null;
  const fm = h('textarea', { className: 'input mono', rows: 6, spellcheck: false, value: d.frontmatterText, ariaLabel: 'Frontmatter (YAML)' });
  const body = h('textarea', { className: 'input mono', rows: 16, value: d.body, ariaLabel: 'Body (Markdown)' });
  const summary = h('div', { className: 'summary', ariaLive: 'polite' });
  const previewSlot = h('div', { hidden: true });
  const outcome = h('div', {});
  const saveBtn = h('button', { type: 'button', className: 'btn btn-primary', disabled: true }, 'Save');
  let timer = null;
  let valid = true;
  const dirty = () => fm.value !== d.frontmatterText || body.value !== d.body;

  const validate = async () => {
    try {
      const v = await api('skills/validate', { method: 'POST', body: { dirName: skill.dirName, frontmatterText: fm.value, body: body.value } });
      valid = v.ok;
      mount(summary,
        h('p', {}, `Listing: ${tokens(v.cost.tokens)} tokens (${num(v.cost.chars)} chars)${v.cost.truncated ? ', description cut at 1536 chars' : ''}`),
        v.errors.length ? h('ul', { className: 'errors', role: 'alert' }, v.errors.map((e) => h('li', {}, e))) : null);
    } catch (e) {
      mount(summary, notice('error', `Couldn't check the frontmatter: ${e.message}`));
    }
    saveBtn.disabled = !valid || !dirty();
  };
  const onEdit = () => {
    saveBtn.disabled = true;
    clearTimeout(timer);
    timer = setTimeout(validate, VALIDATE_DEBOUNCE_MS);
    if (!previewSlot.hidden) mount(previewSlot, preview(body.value));
  };
  fm.addEventListener('input', onEdit);
  body.addEventListener('input', onEdit);

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const res = await api('skills/content', { method: 'PUT', body: { ...target, frontmatterText: fm.value, body: body.value, baseEtag: etag } });
      etag = res.etag;
      d.frontmatterText = fm.value;
      d.body = body.value;
      const g = project ? gitNotice(project, res.git) : null;
      mount(outcome, notice(g ? 'warn' : 'info', 'Saved. ', pickupNotice(skill), g ? h('p', {}, g) : null));
      app.loadInventory();
    } catch (e) {
      mount(outcome, notice('error', e.code === 'STALE' ? 'SKILL.md changed on disk since you opened it. ' : `Couldn't save: ${e.message} `,
        e.code === 'STALE' ? h('button', { type: 'button', className: 'btn btn-small', onClick: () => app.renderPane() }, 'Reload (drops your edits)') : null));
      saveBtn.disabled = false;
    }
  });

  const previewBtn = h('button', { type: 'button', className: 'btn', ariaPressed: 'false' }, 'Preview');
  previewBtn.addEventListener('click', () => {
    previewSlot.hidden = !previewSlot.hidden;
    previewBtn.ariaPressed = String(!previewSlot.hidden);
    if (!previewSlot.hidden) mount(previewSlot, preview(body.value));
  });

  const isOff = skill.override.effective === 'off';
  const toggleBtn = h('button', { type: 'button', className: 'btn', disabled: skill.override.lockedByPolicy }, isOff ? 'Enable' : 'Disable');
  toggleBtn.addEventListener('click', async () => {
    try {
      const res = await api('skills/enabled', { method: 'PUT', body: { ...target, enabled: isOff } });
      const g = project ? gitNotice(project, res.git) : null;
      app.notify(g ? 'warn' : 'info', `${skill.invokeName} ${isOff ? 'enabled' : 'disabled'}. ${TOGGLE_NOTICE}`, g ? h('p', {}, g) : null);
      await app.loadInventory();
      app.renderPane();
    } catch (e) {
      mount(outcome, notice('error', `Couldn't change it: ${e.message}`));
    }
  });

  const deleteBtn = h('button', { type: 'button', className: 'btn btn-danger' }, 'Delete');
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: `Delete ${skill.invokeName}?`, message: `The folder ${skill.path.replace(/\/SKILL\.md$/, '')} moves to Code Skill's trash. You can restore it from the Trash tab.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      const res = await api('skills/delete', { method: 'POST', body: target });
      const g = project ? gitNotice(project, res.git) : null;
      const entry = { trashId: res.trashId, name: skill.dirName, scope: target.scope, project };
      app.notify(g ? 'warn' : 'info', `${skill.invokeName} moved to the trash. `, h('button', { type: 'button', className: 'btn btn-small', onClick: () => restore(app, entry) }, 'Undo'), g ? h('p', {}, g) : null);
      app.closePane();
      app.loadInventory();
      app.loadTrash();
    } catch (e) {
      mount(outcome, notice('error', `Couldn't delete: ${e.message}`));
    }
  });

  mount(pane,
    header(app, skill.invokeName, meta(app, skill)),
    warningsList(skill),
    h('p', { className: 'muted path' }, skill.path),
    notice('info', pickupNotice(skill), project ? h('p', {}, projectWriteNotice(project)) : null),
    overrideSummary(skill),
    field('Frontmatter (YAML)', fm),
    field('Body (Markdown)', body),
    summary,
    h('div', { className: 'actions' }, saveBtn, previewBtn, toggleBtn, deleteBtn),
    outcome,
    previewSlot,
    h('section', { className: 'sub' }, h('h3', {}, 'Files'), h('ul', { className: 'plain mono' }, d.files.map((f) => h('li', {}, f)))),
    evalsBox(app, skill));
  validate();
}

function newSkillView(app, pane) {
  const projects = app.state.inventory?.projects ?? [];
  const scope = h('select', { className: 'input', ariaLabel: 'Where' },
    h('option', { value: 'user' }, 'You (~/.claude/skills): every session'),
    projects.map((p) => h('option', { value: `project:${p}` }, `Project ${p}: its sessions`)));
  const name = h('input', { type: 'text', className: 'input mono', ariaLabel: 'Name', placeholder: 'my-skill', autocomplete: 'off', spellcheck: false });
  const nameHint = h('p', { className: 'hint', ariaLive: 'polite' });
  const description = h('textarea', { className: 'input', rows: 3, ariaLabel: 'Description', placeholder: 'What the skill does and when Claude should use it' });
  const costHint = h('p', { className: 'hint', ariaLive: 'polite' });
  const body = h('textarea', { className: 'input mono', rows: 10, ariaLabel: 'Body (Markdown)', value: '' });
  const outcome = h('div', {});
  const create = h('button', { type: 'button', className: 'btn btn-primary', disabled: true }, 'Create');
  const where = () => (scope.value === 'user' ? { scope: 'user' } : { scope: 'project', project: scope.value.slice('project:'.length) });
  const exists = () => {
    const w = where();
    const id = w.scope === 'user' ? `user:~:${name.value}` : `project:${w.project}:${name.value}`;
    return app.state.inventory?.skills.some((s) => s.id === id);
  };
  const update = () => {
    const check = validateSkillName(name.value);
    const taken = check.ok && exists();
    name.ariaInvalid = String(Boolean(name.value) && (!check.ok || taken));
    mount(nameHint, !name.value ? 'Lowercase letters, digits and hyphens.' : !check.ok ? check.message : taken ? 'A skill with this name already exists there.' : `Invoked as ${name.value}.`);
    const c = costOf({ invokeName: name.value || 'name', description: description.value });
    mount(costHint, `Listing: ${tokens(c.tokens)} tokens (${num(c.chars)} chars)${c.truncated ? ', description cut at 1536 chars' : ''}`);
    create.disabled = !check.ok || taken || !description.value.trim();
  };
  for (const el of [scope, name, description]) el.addEventListener('input', update);
  name.addEventListener('input', () => {
    if (!body.dataset.touched) body.value = name.value ? `# ${name.value}\n\n` : '';
  });
  body.addEventListener('input', () => { body.dataset.touched = '1'; });
  create.addEventListener('click', async () => {
    create.disabled = true;
    const w = where();
    try {
      const res = await api('skills', { method: 'POST', body: { ...w, name: name.value, description: description.value, body: body.value } });
      const g = w.project ? gitNotice(w.project, res.git) : null;
      app.notify(g ? 'warn' : 'info', `Created ${name.value}. `, pickupNotice({ source: w.scope }), g ? h('p', {}, g) : null);
      await app.loadInventory();
      app.openSkill(res.skill?.id ?? `${w.scope === 'user' ? 'user:~' : `project:${w.project}`}:${name.value}`);
    } catch (e) {
      mount(outcome, notice('error', `Couldn't create it: ${e.message}`));
      create.disabled = false;
    }
  });
  mount(pane,
    header(app, 'New skill'),
    field('Where', scope, projects.length ? h('p', { className: 'hint' }, 'Project skills are written to that project\'s main checkout (uncommitted).') : null),
    field('Name', name, nameHint),
    field('Description', description, costHint),
    field('Body (Markdown)', body),
    h('div', { className: 'actions' }, create),
    outcome);
  update();
}

let renderSeq = 0;

export async function renderPane(app, pane) {
  const seq = ++renderSeq;
  const p = app.state.pane;
  if (p.kind === 'new') return newSkillView(app, pane);
  mount(pane, header(app, 'Loading…'));
  let d;
  try {
    d = await api(`skills/detail?id=${encodeURIComponent(p.id)}`);
  } catch (e) {
    if (seq === renderSeq) mount(pane, header(app, 'Skill'), notice('error', e.code === 'NOT_FOUND' ? 'That skill is no longer in the inventory.' : `Couldn't load it: ${e.message}`));
    return;
  }
  if (seq !== renderSeq) return;
  (d.skill.writable ? editableView : readOnlyView)(app, pane, d);
}
