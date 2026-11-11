// System-prompt cost of a skill's listing entry, using the Claude Code CLI's
// own formula (tracked against CLI 2.1.319). Served to the browser as
// /shared/cost.js so the editor's live estimate and the inventory agree.

// skillListingMaxDescChars default: a listing text longer than this is cut.
export const LISTING_MAX_DESC_CHARS = 1536;
// The CLI's own chars-per-token estimate.
export const LISTING_BYTES_PER_TOKEN = 4;
// Share of the context window the whole skill listing may take.
export const LISTING_BUDGET_FRACTION = 0.01;
// Context sizes the budget is always shown for.
export const REFERENCE_CONTEXT_TOKENS = Object.freeze([200_000, 1_000_000]);

// "description - when_to_use", the text the listing shows after the name.
export function listingText({ description, whenToUse }) {
  const d = description ?? '';
  return whenToUse ? `${d} - ${whenToUse}` : d;
}

// Characters of one listing line ("- name: text"), or "- name" when name-only.
export function entryChars(invokeName, text, listing = 'full') {
  if (listing === 'hidden') return 0;
  if (listing === 'name-only') return invokeName.length + 2;
  return invokeName.length + 4 + Math.min(text.length, LISTING_MAX_DESC_CHARS);
}

export function entryTokens(chars) {
  return Math.ceil(chars / LISTING_BYTES_PER_TOKEN);
}

// Listing budget in characters for a context window of `contextTokens`.
export function listingBudgetChars(contextTokens) {
  return Math.floor(contextTokens * LISTING_BYTES_PER_TOKEN * LISTING_BUDGET_FRACTION);
}

// Listing state for an effective skillOverrides value plus frontmatter flags.
export function listingFor(effective, disableModelInvocation) {
  if (disableModelInvocation) return 'hidden';
  if (effective === 'off' || effective === 'user-invocable-only') return 'hidden';
  if (effective === 'name-only') return 'name-only';
  return 'full';
}

// → { listing, chars, tokens, truncated }
export function costOf({ invokeName, description, whenToUse, listing = 'full' }) {
  const text = listingText({ description, whenToUse });
  const chars = entryChars(invokeName, text, listing);
  return { listing, chars, tokens: entryTokens(chars), truncated: listing === 'full' && text.length > LISTING_MAX_DESC_CHARS };
}

// Characters of a whole listing: entries joined with "\n".
export function listingTotalChars(entryCharsList) {
  const shown = entryCharsList.filter((c) => c > 0);
  return shown.reduce((a, b) => a + b, 0) + Math.max(0, shown.length - 1);
}
