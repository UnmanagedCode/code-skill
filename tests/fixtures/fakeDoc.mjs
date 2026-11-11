// A minimal fake document: records every method called on it, builds plain
// element objects, and throws if anything sets innerHTML/outerHTML or calls an
// HTML-parsing or attribute API.
export function fakeDoc() {
  const calls = [];
  const trap = (name) => () => { throw new Error(`fakeDoc: ${name} used`); };
  const makeEl = (tag) => {
    const el = {
      nodeType: 1, tagName: tag.toUpperCase(), children: [], dataset: {}, listeners: {},
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      get firstChild() { return this.children[0] ?? null; },
      addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
      setAttribute: trap('setAttribute'),
      insertAdjacentHTML: trap('insertAdjacentHTML'),
      get textContent() { return this.children.map((c) => c.textContent ?? c.data).join(''); },
    };
    for (const prop of ['innerHTML', 'outerHTML']) Object.defineProperty(el, prop, { set: trap(`${prop} =`), get: trap(prop) });
    return el;
  };
  const doc = new Proxy({
    createElement(tag) { calls.push('createElement'); return makeEl(tag); },
    createTextNode(data) { calls.push('createTextNode'); return { nodeType: 3, data, textContent: data }; },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      throw new Error(`fakeDoc: document.${String(prop)} used`);
    },
  });
  return { doc, calls };
}

// Every element in a tree built on fakeDoc.
export function walk(node, out = []) {
  out.push(node);
  for (const c of node.children ?? []) walk(c, out);
  return out;
}
