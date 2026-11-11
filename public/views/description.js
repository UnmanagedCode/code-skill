// The description block of a skill's detail pane: the text Claude sees in the
// listing (description, then when_to_use) and what it costs. Text nodes only.
import { h } from '../dom.js';
import { num, tokens } from '../format.js';

export function descriptionBlock({ description, whenToUse, cost }) {
  return h('section', { className: 'sub description', ariaLabel: 'Description' },
    h('h3', {}, 'Description'),
    description ? h('p', { className: 'desc-text' }, description) : h('p', { className: 'muted' }, 'No description'),
    whenToUse ? h('h3', {}, 'When to use') : null,
    whenToUse ? h('p', { className: 'desc-text' }, whenToUse) : null,
    cost ? h('p', { className: 'hint' }, `Listing: ${tokens(cost.tokens)} tokens (${num(cost.chars)} chars)${cost.truncated ? ', description cut at 1536 chars' : ''}`) : null);
}
