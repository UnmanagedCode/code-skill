import { listingText } from '../shared/cost.js';

// Near-duplicate skills: Jaccard similarity of their listing texts' word sets.
export const NEAR_DUP_THRESHOLD = 0.6;
export const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'use', 'when', 'from', 'into', 'are', 'you', 'your',
  'any', 'all', 'not', 'but', 'its', 'can', 'via', 'how', 'what', 'which', 'skill', 'skills', 'user', 'asks',
]);

export function wordSet(text) {
  const words = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

// Two skills that can never share a session: project skills of different projects.
const neverTogether = (x, y) => x.source === 'project' && y.source === 'project' && x.owner.project !== y.owner.project;

// → [{ a, b, score }] (ids), score descending, then ids.
export function nearDuplicates(records) {
  const sets = records.map((r) => wordSet(listingText(r)));
  const out = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const [x, y] = [records[i], records[j]];
      if (x.invokeName === y.invokeName || neverTogether(x, y)) continue;
      const score = jaccard(sets[i], sets[j]);
      if (score < NEAR_DUP_THRESHOLD) continue;
      const [a, b] = [x.id, y.id].sort();
      out.push({ a, b, score: Math.round(score * 100) / 100 });
    }
  }
  return out.sort((p, q) => q.score - p.score || p.a.localeCompare(q.a) || p.b.localeCompare(q.b));
}
