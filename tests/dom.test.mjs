import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDom } from '../public/dom.js';
import { fakeDoc } from './fixtures/fakeDoc.mjs';

const setup = () => {
  const f = fakeDoc();
  return { ...f, ...createDom(() => f.doc) };
};

// Invariant: data reaches the DOM only as text nodes and allowlisted properties.
test('string and number children become text nodes', () => {
  const { h } = setup();
  const el = h('p', { className: 'x' }, '<b>hi</b>', 3, null, false, ['a', ['b']]);
  assert.deepEqual(el.children.map((c) => c.nodeType), [3, 3, 3, 3]);
  assert.equal(el.textContent, '<b>hi</b>3ab');
  assert.equal(el.className, 'x');
});

test('an unknown prop or a string handler throws', () => {
  const { h } = setup();
  assert.throws(() => h('div', { innerHTML: '<x>' }), /not allowed/);
  assert.throws(() => h('a', { href: 'javascript:x' }), /not allowed/);
  assert.throws(() => h('div', { style: 'color:red' }), /not allowed/);
  assert.throws(() => h('button', { onClick: 'alert(1)' }), /must be a function/);
});

test('handlers attach via addEventListener; dataset is written per key', () => {
  const { h } = setup();
  const fn = () => {};
  const el = h('button', { onClick: fn, dataset: { id: 7 } });
  assert.deepEqual(el.listeners.click, [fn]);
  assert.deepEqual(el.dataset, { id: '7' });
});

test('mount replaces children; innerHTML is never touched', () => {
  const { h, mount } = setup();
  const el = h('div', {}, 'old', h('span', {}, 'x'));
  mount(el, 'new');
  assert.equal(el.textContent, 'new');
});
