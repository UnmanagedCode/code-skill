import { h } from '../dom.js';
import { num, bytes, ago } from '../format.js';
import { notice } from '../notices.js';

export function renderUsage(app) {
  const { usage, usageError, inventory } = app.state;
  if (usageError) return notice('error', `Couldn't scan transcripts: ${usageError.message}`);
  if (!usage) return h('p', { className: 'muted' }, 'Scanning session transcripts… (the first scan reads every transcript; later ones read only new bytes)');
  const installed = new Map((inventory?.skills ?? []).map((s) => [s.invokeName, s]));
  const used = new Set(usage.skills.map((u) => u.invokeName));
  const never = inventory ? [...installed.values()].filter((s) => !used.has(s.invokeName)).sort((a, b) => a.invokeName.localeCompare(b.invokeName)) : [];
  const gone = inventory ? usage.skills.filter((u) => !installed.has(u.invokeName)) : [];
  const s = usage.scan;
  const open = (skill) => h('button', { type: 'button', className: 'link', onClick: () => app.openSkill(skill.id) }, skill.invokeName);
  return h('div', { className: 'stack' },
    h('p', { className: 'muted', dataset: { scan: '' } }, `Scanned ${num(s.files)} transcripts, read ${bytes(s.bytesRead)} from ${num(s.filesRead)} in ${num(s.ms)} ms${s.malformedLines ? ` (${num(s.malformedLines)} unreadable lines skipped)` : ''}. Counts Skill tool calls; skills you invoke by typing /name are not counted.`,
      ' ', h('button', { type: 'button', className: 'btn btn-small', onClick: () => app.loadUsage() }, 'Rescan')),
    h('section', { className: 'card', ariaLabel: 'Skill usage' },
      h('h2', {}, 'Most used'),
      usage.skills.length === 0 ? h('p', { className: 'muted' }, 'No Skill tool calls found.') : h('div', { className: 'scroll' }, h('table', { className: 'grid' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Skill'), h('th', { className: 'n' }, 'Uses'), h('th', { className: 'n' }, 'Sessions'), h('th', {}, 'Last used'))),
        h('tbody', {}, usage.skills.map((u) => h('tr', { dataset: { usage: u.invokeName } },
          h('td', {}, installed.has(u.invokeName) ? open(installed.get(u.invokeName)) : u.invokeName),
          h('td', { className: 'n' }, num(u.count)), h('td', { className: 'n' }, num(u.sessions)), h('td', { title: u.lastUsedAt ?? '' }, ago(u.lastUsedAt)))))))),
    h('section', { className: 'card', ariaLabel: 'Never fired' },
      h('h2', {}, `Never fired (${never.length})`),
      never.length ? h('ul', { className: 'pills' }, never.map((sk) => h('li', {}, open(sk)))) : h('p', { className: 'muted' }, 'Every installed skill has fired at least once.')),
    h('section', { className: 'card', ariaLabel: 'Invoked but no longer installed' },
      h('h2', {}, `Invoked but no longer installed (${gone.length})`),
      gone.length ? h('ul', { className: 'pills' }, gone.map((u) => h('li', {}, `${u.invokeName} · ${num(u.count)}`))) : h('p', { className: 'muted' }, 'None.')));
}
