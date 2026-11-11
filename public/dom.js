// The only place DOM nodes are made. Strings always become text nodes; a
// prop is set only from the allowlist below, handlers only as functions.

const PROPS = new Set([
  'className', 'id', 'type', 'value', 'checked', 'disabled', 'title', 'htmlFor', 'role', 'name',
  'ariaLabel', 'ariaSelected', 'ariaPressed', 'ariaExpanded', 'ariaControls', 'ariaLive', 'ariaInvalid', 'ariaDescribedBy',
  'placeholder', 'readOnly', 'rows', 'hidden', 'tabIndex', 'colSpan', 'spellcheck', 'autocomplete', 'max', 'dataset',
]);

export function createDom(getDoc) {
  const append = (el, child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { for (const c of child) append(el, c); return; }
    if (typeof child === 'string' || typeof child === 'number') { el.appendChild(getDoc().createTextNode(String(child))); return; }
    el.appendChild(child);
  };

  // h('button', { className: 'x', onClick: fn }, 'Label', child, [more])
  function h(tag, props, ...children) {
    const el = getDoc().createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
      if (v === undefined) continue;
      if (/^on[A-Z]/.test(k)) {
        if (typeof v !== 'function') throw new TypeError(`h(): ${k} must be a function`);
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'dataset') {
        for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = String(dv);
      } else if (PROPS.has(k)) {
        el[k] = v;
      } else {
        throw new TypeError(`h(): prop "${k}" is not allowed`);
      }
    }
    append(el, children);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  // Replaces el's children with `children`.
  function mount(el, ...children) {
    clear(el);
    append(el, children);
    return el;
  }

  return { h, clear, mount };
}

export const { h, clear, mount } = createDom(() => globalThis.document);
