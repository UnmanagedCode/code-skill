import { h, mount } from '../dom.js';
import { api } from '../api.js';
import { num, tokens, contextLabel, ago, SOURCE_LABELS } from '../format.js';
import { notice, gitNotice, TOGGLE_NOTICE } from '../notices.js';

const SOURCES = Object.keys(SOURCE_LABELS);

export const scopeOf = (skill) => (skill.source === 'project' ? { scope: 'project', project: skill.owner.project } : { scope: 'user' });

// Usage per invoke name, or null while the scan is still running.
export const usageMap = (usage) => (usage ? new Map(usage.skills.map((u) => [u.invokeName, u])) : null);

function appliesTo(total) {
  if (total.everySession) return 'every session';
  if (total.source === 'project') return `sessions in ${total.label.replace(/^project /, '')}`;
  if (total.source === 'convention') return 'its sessions';
  return 'sessions in that project';
}

function budgetSection(inv) {
  const { baseline, contexts } = inv.budget;
  return h('section', { className: 'card', ariaLabel: 'Listing budget' },
    h('h2', {}, 'Listing budget'),
    h('p', {}, `Every session lists these ${num(baseline.count)} skills: ${tokens(baseline.tokens)} tokens (${num(baseline.chars)} chars). Sessions add their project's skills and their convention skills on top.`),
    h('div', { className: 'scroll' }, h('table', { className: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Context'), h('th', { className: 'n' }, 'Budget (chars)'), h('th', {}, 'Every-session listing'))),
      h('tbody', {}, contexts.map((c) => {
        const pct = Math.round((baseline.chars / c.chars) * 100);
        return h('tr', { dataset: { context: c.contextTokens } },
          h('td', {}, `${contextLabel(c.contextTokens)} tokens`, c.live ? h('span', { className: 'tag' }, 'live session') : null),
          h('td', { className: 'n' }, num(c.chars)),
          h('td', {}, h('progress', { max: c.chars, value: Math.min(baseline.chars, c.chars), ariaLabel: `${pct}% of the ${contextLabel(c.contextTokens)} budget` }), ` ${pct}%`, pct > 100 ? h('span', { className: 'tag tag-warn' }, 'over budget') : null));
      })))),
    h('p', { className: 'muted' }, 'Budget = context tokens × 4 chars × 1%. Over budget, Claude Code shortens skill descriptions in the listing to fit.'));
}

function totalsSection(inv) {
  const rows = [...inv.totals].sort((a, b) => Number(b.everySession) - Number(a.everySession) || b.chars - a.chars);
  return h('section', { className: 'card', ariaLabel: 'Totals by owner' },
    h('h2', {}, 'Totals by owner'),
    h('div', { className: 'scroll' }, h('table', { className: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Owner'), h('th', { className: 'n' }, 'Skills'), h('th', { className: 'n' }, 'Chars'), h('th', { className: 'n' }, 'Tokens'), h('th', {}, 'Listed in'))),
      h('tbody', {}, rows.map((t) => h('tr', { dataset: { total: t.key } },
        h('td', {}, t.label), h('td', { className: 'n' }, num(t.count)),
        h('td', { className: 'n' }, num(t.chars)), h('td', { className: 'n' }, tokens(t.tokens)), h('td', {}, appliesTo(t))))))));
}

// ⚠ markers: warnings, duplicate and near-duplicate notes for one skill.
function markersFor(skill, inv, byId) {
  const notes = [...skill.warnings];
  for (const d of inv.duplicates) if (d.ids.includes(skill.id)) notes.push(`duplicate name: ${d.note}`);
  for (const n of inv.nearDuplicates) {
    const other = n.a === skill.id ? n.b : n.b === skill.id ? n.a : null;
    if (other) notes.push(`similar to ${byId.get(other)?.invokeName ?? other} (${Math.round(n.score * 100)}%)`);
  }
  return notes;
}

async function toggle(app, skill, enabled) {
  try {
    const res = await api('skills/enabled', { method: 'PUT', body: { ...scopeOf(skill), name: skill.dirName, enabled } });
    const g = skill.source === 'project' ? gitNotice(skill.owner.project, res.git) : null;
    app.notify(g ? 'warn' : 'info', `${skill.invokeName} ${enabled ? 'enabled' : 'disabled'}. ${TOGGLE_NOTICE}`, g ? h('p', {}, g) : null);
  } catch (e) {
    app.notify('error', `Couldn't ${enabled ? 'enable' : 'disable'} ${skill.invokeName}: ${e.message}`);
  }
  await app.loadInventory();
  if (app.state.pane?.kind === 'skill' && app.state.pane.id === skill.id) app.renderPane();
}

const MISMATCH_TITLE = 'Frontmatter name ≠ folder name: fix the name to enable or disable it';

function stateCell(app, skill) {
  if (skill.writable && !skill.toggleable) {
    return h('label', { className: 'switch', title: MISMATCH_TITLE },
      h('input', { type: 'checkbox', role: 'switch', checked: skill.override.effective !== 'off', disabled: true, ariaLabel: `Enabled: ${skill.invokeName} (${MISMATCH_TITLE})` }),
      h('span', {}, skill.override.effective));
  }
  if (skill.toggleable) {
    const eff = skill.override.effective;
    const locked = skill.override.lockedByPolicy;
    return h('label', { className: 'switch', title: locked ? 'Set by managed policy' : eff === 'on' || eff === 'off' ? '' : `skillOverrides: ${eff}` },
      h('input', { type: 'checkbox', role: 'switch', checked: eff !== 'off', disabled: locked, ariaLabel: `Enabled: ${skill.invokeName}`, onChange: (e) => toggle(app, skill, e.target.checked) }),
      h('span', {}, locked ? `${eff} (policy)` : eff === 'off' ? 'off' : eff === 'on' ? 'on' : eff));
  }
  if (skill.source === 'host-plugin') return h('span', { className: 'badge' }, skill.enabled ? 'plugin enabled' : 'plugin disabled');
  return h('span', { className: 'badge', title: `owned by ${skill.owner.label}` }, 'read-only');
}

function listingCell(skill) {
  const c = skill.cost;
  if (c.listing === 'hidden') return h('span', { className: 'muted' }, 'not listed');
  return h('span', {}, c.listing === 'name-only' ? 'name only' : 'full', c.truncated ? h('span', { className: 'tag tag-warn' }, 'cut') : null);
}

function usesCell(skill, usage) {
  if (!usage) return h('span', { className: 'muted' }, '…');
  const u = usage.get(skill.invokeName);
  return u ? num(u.count) : h('span', { className: 'muted' }, 'never fired');
}

function matches(skill, state) {
  if (state.sources.size && !state.sources.has(skill.source)) return false;
  const q = state.filter.trim().toLowerCase();
  if (!q) return true;
  return [skill.invokeName, skill.description, skill.owner.label].some((s) => s?.toLowerCase().includes(q));
}

function skillTable(app) {
  const { inventory: inv, usage } = app.state;
  const byId = new Map(inv.skills.map((s) => [s.id, s]));
  const uses = usageMap(usage);
  const rows = inv.skills.filter((s) => matches(s, app.state)).sort((a, b) => a.invokeName.localeCompare(b.invokeName) || a.id.localeCompare(b.id));
  if (!rows.length) return h('p', { className: 'muted' }, 'No skills match.');
  return h('div', { className: 'scroll' }, h('table', { className: 'grid skills', ariaLabel: 'Skills' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Skill'), h('th', {}, 'Source'), h('th', { className: 'wide-only' }, 'Owner'), h('th', { className: 'n' }, 'Tokens'),
      h('th', { className: 'wide-only' }, 'Listing'), h('th', { className: 'n' }, 'Uses'), h('th', { className: 'wide-only' }, 'Last used'), h('th', {}, 'State'))),
    h('tbody', {}, rows.map((s) => {
      const notes = markersFor(s, inv, byId);
      const u = uses?.get(s.invokeName);
      // A click anywhere on the row opens the skill; the name button keeps it keyboard-reachable.
      return h('tr', {
        dataset: { id: s.id }, className: app.state.pane?.id === s.id ? 'skill-row selected' : 'skill-row',
        onClick: (e) => { if (!e.target.closest('button, input, label, a')) app.openSkill(s.id); },
      },
        h('td', {},
          h('button', { type: 'button', className: 'link', onClick: () => app.openSkill(s.id) }, s.invokeName),
          notes.length ? h('span', { className: 'marker', title: notes.join('\n'), ariaLabel: `${notes.length} note${notes.length > 1 ? 's' : ''}: ${notes.join('; ')}`, role: 'img' }, '⚠') : null),
        h('td', {}, h('span', { className: `src src-${s.source}` }, SOURCE_LABELS[s.source])),
        h('td', { className: 'owner wide-only' }, s.owner.label),
        h('td', { className: 'n' }, s.cost.listing === 'hidden' ? '0' : tokens(s.cost.tokens)),
        h('td', { className: 'wide-only' }, listingCell(s)),
        h('td', { className: 'n' }, usesCell(s, uses)),
        h('td', { className: 'wide-only' }, u ? ago(u.lastUsedAt) : '—'),
        h('td', {}, stateCell(app, s)));
    }))));
}

export function renderInventory(app) {
  const { inventory: inv, inventoryError: err } = app.state;
  if (err) return notice('error', `Couldn't load the inventory: ${err.message}`);
  if (!inv) return h('p', { className: 'muted' }, 'Loading skills…');
  const tableSlot = h('div', {}, skillTable(app));
  const refreshTable = () => mount(tableSlot, skillTable(app));
  const chips = h('div', { className: 'chips', role: 'group', ariaLabel: 'Filter by source' },
    SOURCES.filter((src) => inv.skills.some((s) => s.source === src)).map((src) => h('button', {
      type: 'button', className: 'chip', ariaPressed: String(app.state.sources.has(src)),
      onClick: (e) => {
        if (app.state.sources.has(src)) app.state.sources.delete(src); else app.state.sources.add(src);
        e.currentTarget.ariaPressed = String(app.state.sources.has(src));
        refreshTable();
      },
    }, SOURCE_LABELS[src])));
  return h('div', { className: 'stack' },
    inv.sourceErrors.map((e) => notice('error', `${e.source}: ${e.message}`)),
    h('div', { className: 'cards' }, budgetSection(inv), totalsSection(inv)),
    h('section', { className: 'card', ariaLabel: 'All skills' },
      h('h2', {}, `Skills (${inv.skills.length})`),
      h('div', { className: 'toolbar' },
        h('input', { type: 'search', className: 'input', placeholder: 'Filter by name, description or owner', ariaLabel: 'Filter skills', value: app.state.filter, onInput: (e) => { app.state.filter = e.target.value; refreshTable(); } }),
        chips),
      tableSlot));
}
