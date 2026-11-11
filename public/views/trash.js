import { h } from '../dom.js';
import { api } from '../api.js';
import { ago } from '../format.js';
import { notice, gitNotice } from '../notices.js';

export async function restore(app, entry) {
  try {
    const res = await api(`trash/${encodeURIComponent(entry.trashId)}/restore`, { method: 'POST' });
    const g = entry.scope === 'project' ? gitNotice(entry.project, res.git) : null;
    app.notify(g ? 'warn' : 'info', `Restored ${entry.name}.`, g ? h('p', {}, g) : null);
    await Promise.all([app.loadInventory(), app.loadTrash()]);
    if (res.id) app.openSkill(res.id);
  } catch (e) {
    app.notify('error', `Couldn't restore ${entry.name}: ${e.message}`);
  }
}

export function renderTrash(app) {
  const { trash, trashError } = app.state;
  if (trashError) return notice('error', `Couldn't read the trash: ${trashError.message}`);
  if (!trash) return h('p', { className: 'muted' }, 'Loading trash…');
  return h('section', { className: 'card', ariaLabel: 'Trash' },
    h('h2', {}, 'Trash'),
    h('p', { className: 'muted' }, 'Deleted skills are kept here, in the plugin\'s data folder, until restored.'),
    trash.entries.length === 0 ? h('p', { className: 'muted' }, 'The trash is empty.') : h('div', { className: 'scroll' }, h('table', { className: 'grid' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Skill'), h('th', {}, 'Where'), h('th', {}, 'Deleted'), h('th', {}, ''))),
      h('tbody', {}, trash.entries.map((e) => h('tr', { dataset: { trash: e.trashId } },
        h('td', {}, e.name),
        h('td', { title: e.originalPath }, e.scope === 'project' ? `project ${e.project}` : 'you (~/.claude/skills)'),
        h('td', { title: e.deletedAt }, ago(e.deletedAt)),
        h('td', {}, h('button', { type: 'button', className: 'btn btn-small', onClick: () => restore(app, e) }, 'Restore'))))))));
}
