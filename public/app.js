// App shell: tabs, URL state (?tab=&skill=), data loading and notices. Views
// render from `app.state`; the side pane (views/editor.js) owns its own form state.
import { h, mount } from './dom.js';
import { api } from './api.js';
import { notice } from './notices.js';
import { renderInventory } from './views/inventory.js';
import { renderUsage } from './views/usage.js';
import { renderTrash } from './views/trash.js';
import { renderPane } from './views/editor.js';

const TABS = [{ id: 'inventory', label: 'Inventory' }, { id: 'usage', label: 'Usage' }, { id: 'trash', label: 'Trash' }];
const MAX_NOTICES = 3;

const params = new URLSearchParams(location.search);
const state = {
  tab: TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'inventory',
  inventory: null,
  inventoryError: null,
  usage: null,
  usageError: null,
  trash: null,
  trashError: null,
  filter: '',
  sources: new Set(),
  pane: params.get('skill') ? { kind: 'skill', id: params.get('skill') } : null,
  notices: [],
};

const $ = (id) => document.getElementById(id);

function syncUrl() {
  const p = new URLSearchParams();
  if (state.tab !== 'inventory') p.set('tab', state.tab);
  if (state.pane?.kind === 'skill') p.set('skill', state.pane.id);
  const q = p.toString();
  history.replaceState(null, '', q ? `?${q}` : location.pathname);
}

const app = {
  state,

  async loadInventory() {
    try {
      state.inventory = await api('inventory');
      state.inventoryError = null;
    } catch (e) {
      state.inventoryError = e;
    }
    app.render();
  },

  async loadUsage() {
    state.usageError = null;
    try {
      state.usage = await api('usage');
    } catch (e) {
      state.usageError = e;
    }
    app.render();
  },

  async loadTrash() {
    try {
      state.trash = await api('trash');
      state.trashError = null;
    } catch (e) {
      state.trashError = e;
    }
    app.render();
  },

  setTab(id) {
    state.tab = id;
    syncUrl();
    if (id === 'trash') app.loadTrash();
    app.render();
  },

  openSkill(id) {
    state.pane = { kind: 'skill', id };
    syncUrl();
    app.renderPane();
  },

  openNew() {
    state.pane = { kind: 'new' };
    syncUrl();
    app.renderPane();
  },

  closePane() {
    state.pane = null;
    syncUrl();
    app.renderPane();
  },

  // notify('info' | 'warn' | 'error', ...children)
  notify(kind, ...children) {
    const entry = { kind, children, key: Symbol('notice') };
    state.notices = [entry, ...state.notices].slice(0, MAX_NOTICES);
    renderNotices();
  },

  render() {
    renderTabs();
    const view = { inventory: renderInventory, usage: renderUsage, trash: renderTrash }[state.tab];
    mount($('main'), view(app));
  },

  renderPane() {
    const pane = $('pane');
    pane.hidden = !state.pane;
    $('layout').classList.toggle('has-pane', Boolean(state.pane));
    if (state.pane) renderPane(app, pane);
  },
};

function renderTabs() {
  mount($('tabs'), h('div', { role: 'tablist', className: 'tabs', ariaLabel: 'Views' },
    TABS.map((t) => h('button', {
      type: 'button', role: 'tab', className: 'tab', ariaSelected: String(state.tab === t.id), id: `tab-${t.id}`,
      onClick: () => app.setTab(t.id),
    }, t.label))));
  mount($('top-actions'),
    h('button', { type: 'button', className: 'btn', onClick: () => { app.loadInventory(); app.loadUsage(); if (state.tab === 'trash') app.loadTrash(); } }, 'Refresh'),
    h('button', { type: 'button', className: 'btn btn-primary', onClick: () => app.openNew() }, 'New skill'));
}

function renderNotices() {
  mount($('status'), state.notices.map((n) => {
    const box = notice(n.kind, n.children);
    box.appendChild(h('button', {
      type: 'button', className: 'btn btn-ghost btn-small', ariaLabel: 'Dismiss',
      onClick: () => { state.notices = state.notices.filter((x) => x.key !== n.key); renderNotices(); },
    }, '✕'));
    return box;
  }));
}

app.render();
app.renderPane();
app.loadInventory();
app.loadUsage();
if (state.tab === 'trash') app.loadTrash();
