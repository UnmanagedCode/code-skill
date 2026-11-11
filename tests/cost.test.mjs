import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costOf, entryChars, listingText, listingFor, listingBudgetChars, listingTotalChars, LISTING_MAX_DESC_CHARS } from '../shared/cost.js';

// Invariant: per-skill listing cost is identical to the CLI's formula (F9).
test('full entry = name + 4 + text, when_to_use joined with " - "', () => {
  assert.equal(listingText({ description: 'Do x', whenToUse: 'when y' }), 'Do x - when y');
  assert.equal(listingText({ description: 'Do x', whenToUse: null }), 'Do x');
  const c = costOf({ invokeName: 'abc', description: 'Do x', whenToUse: 'when y' });
  assert.deepEqual(c, { listing: 'full', chars: 3 + 4 + 'Do x - when y'.length, tokens: Math.ceil((3 + 4 + 13) / 4), truncated: false });
});

test('text over 1536 chars is cut and flagged truncated', () => {
  const c = costOf({ invokeName: 'n', description: 'a'.repeat(2000) });
  assert.equal(c.chars, 1 + 4 + LISTING_MAX_DESC_CHARS);
  assert.equal(LISTING_MAX_DESC_CHARS, 1536);
  assert.equal(c.truncated, true);
});

test('name-only = name + 2; hidden = 0', () => {
  assert.equal(entryChars('plug:skill', 'anything', 'name-only'), 'plug:skill'.length + 2);
  assert.equal(entryChars('x', 'anything', 'hidden'), 0);
  assert.equal(costOf({ invokeName: 'x', description: 'y', listing: 'hidden' }).tokens, 0);
});

test('off, user-invocable-only and disable-model-invocation hide; name-only lists the name', () => {
  assert.equal(listingFor('off', false), 'hidden');
  assert.equal(listingFor('user-invocable-only', false), 'hidden');
  assert.equal(listingFor('on', true), 'hidden');
  assert.equal(listingFor('name-only', false), 'name-only');
  assert.equal(listingFor('on', false), 'full');
});

// Invariant: the listing budget is contextTokens × 4 × 0.01, for any context size.
test('budget scales with the context window', () => {
  assert.equal(listingBudgetChars(200_000), 8000);
  assert.equal(listingBudgetChars(1_000_000), 40_000);
});

test('a listing total joins shown entries with newlines', () => {
  assert.equal(listingTotalChars([10, 0, 20]), 31);
  assert.equal(listingTotalChars([]), 0);
});
