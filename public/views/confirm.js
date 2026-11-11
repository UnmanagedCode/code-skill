import { h } from '../dom.js';

// An in-page modal confirmation (never window.confirm). → Promise<boolean>
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let dlg;
    const done = (value) => {
      dlg.close();
      dlg.remove();
      resolve(value);
    };
    dlg = h('dialog', { className: 'confirm', ariaLabel: title, onCancel: (e) => { e.preventDefault(); done(false); } },
      h('h2', {}, title),
      h('p', {}, message),
      h('div', { className: 'actions' },
        h('button', { type: 'button', className: 'btn', onClick: () => done(false) }, 'Cancel'),
        h('button', { type: 'button', className: danger ? 'btn btn-danger' : 'btn btn-primary', onClick: () => done(true) }, confirmLabel)));
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}
