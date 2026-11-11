import * as hostUser from './discovery/hostUser.js';
import * as project from './discovery/project.js';
import * as synced from './discovery/synced.js';
import * as hostPlugins from './discovery/hostPlugins.js';
import * as ccCore from './discovery/ccCore.js';
import * as ccPlugins from './discovery/ccPlugins.js';
import * as convention from './discovery/convention.js';
import { readLayers } from './overrides/layers.js';
import { effectiveFor } from './overrides/effective.js';
import { nearDuplicates } from './similarity.js';
import {
  costOf, listingFor, entryTokens, listingTotalChars, listingBudgetChars,
  REFERENCE_CONTEXT_TOKENS, LISTING_MAX_DESC_CHARS,
} from '../shared/cost.js';

export const SOURCES = Object.freeze([
  ['user', hostUser], ['project', project], ['synced', synced], ['host-plugin', hostPlugins],
  ['cc-core', ccCore], ['cc-plugin', ccPlugins], ['convention', convention],
]);

const once = (fn) => {
  let p;
  return () => (p ??= fn());
};

// Every skill a cc session can get, with override state, cost, duplicate and
// near-duplicate flags and per-owner totals. A failing source becomes a
// `sourceErrors` entry; only an unreachable cc fails the whole call.
export async function buildInventory({ config, conductor }) {
  const sourceErrors = [];
  const warn = (source, message) => sourceErrors.push({ source, message });
  const projects = await conductor.listProjects();
  const local = projects.filter((p) => p.system === 'local' && typeof p.path === 'string');
  const instances = once(() => conductor.listInstances());
  const ctx = { config, conductor: { ...conductor, listInstances: instances }, warn, localProjects: async () => local };

  const skills = [];
  for (const [source, mod] of SOURCES) {
    try {
      skills.push(...await mod.discover(ctx));
    } catch (e) {
      if (e.code === 'CONDUCTOR_UNREACHABLE') throw e;
      warn(source, e.message);
    }
  }

  const layers = await readLayers(config, local);
  sourceErrors.push(...layers.errors);
  for (const r of skills) {
    if (r.toggleable) r.override = effectiveFor(r, layers);
    const effective = r.override?.effective ?? 'on';
    const listing = r.source === 'host-plugin' && !r.enabled ? 'hidden' : listingFor(effective, r.disableModelInvocation);
    r.cost = costOf({ invokeName: r.invokeName, description: r.description, whenToUse: r.whenToUse, listing });
    if (r.cost.truncated) r.warnings.push(`description truncated at ${LISTING_MAX_DESC_CHARS} chars in listing`);
  }

  const duplicates = findDuplicates(skills);
  const totals = totalsOf(skills);
  let liveContexts = [];
  try {
    liveContexts = (await instances()).map((i) => i.contextWindowTokens).filter((n) => Number.isFinite(n) && n > 0);
  } catch (e) {
    if (e.code === 'CONDUCTOR_UNREACHABLE') throw e;
    warn('convention', `live context sizes unavailable: ${e.message}`);
  }
  const contexts = [...new Set([...REFERENCE_CONTEXT_TOKENS, ...liveContexts])].sort((a, b) => a - b)
    .map((contextTokens) => ({ contextTokens, chars: listingBudgetChars(contextTokens), live: liveContexts.includes(contextTokens) }));
  const baselineChars = skills.filter(inEverySession).map((r) => r.cost.chars);
  const baseline = { count: baselineChars.filter((c) => c > 0).length, chars: listingTotalChars(baselineChars) };
  baseline.tokens = entryTokens(baseline.chars);

  for (const r of skills) delete r.sha;
  return {
    skills,
    projects: local.map((p) => p.name),
    totals,
    budget: { contexts, baseline },
    duplicates,
    nearDuplicates: nearDuplicates(skills),
    sourceErrors,
  };
}

// The record with `id`, from a fresh inventory, or null.
export async function findSkill(deps, id) {
  return (await buildInventory(deps)).skills.find((s) => s.id === id) ?? null;
}

// Sources every session's listing carries (project and convention skills depend on the session).
function inEverySession(r) {
  if (r.source === 'host-plugin') return r.owner.scope === 'user' || r.owner.scope === 'managed';
  return ['user', 'synced', 'cc-core', 'cc-plugin'].includes(r.source);
}

const ownerKeyOf = (r) => (r.source === 'convention' ? `convention:${r.namespace}` : r.id.slice(0, r.id.lastIndexOf(':')));

function totalsOf(skills) {
  const groups = new Map();
  for (const r of skills) {
    const key = ownerKeyOf(r);
    if (!groups.has(key)) groups.set(key, { key, label: r.source === 'convention' ? `convention ${r.namespace}` : r.owner.label, source: r.source, everySession: inEverySession(r), byName: new Map() });
    // A session carries one variant of a convention skill: count the largest.
    const g = groups.get(key);
    g.byName.set(r.invokeName, Math.max(g.byName.get(r.invokeName) ?? 0, r.cost.chars));
  }
  return [...groups.values()].map(({ byName, ...g }) => {
    const chars = [...byName.values()].reduce((a, b) => a + b, 0);
    return { ...g, count: byName.size, chars, tokens: entryTokens(chars) };
  });
}

function findDuplicates(skills) {
  const out = [];
  const byName = new Map();
  for (const r of skills) {
    const k = `${r.source === 'convention' ? 'c' : 'o'}\0${r.invokeName}`;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(r);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const ids = group.map((r) => r.id);
    const invokeName = group[0].invokeName;
    if (group[0].source === 'convention') {
      out.push({ invokeName, ids, note: 'differs between sessions' });
      continue;
    }
    const user = group.find((r) => r.source === 'user');
    const projects = group.filter((r) => r.source === 'project');
    const others = group.filter((r) => r.source !== 'project');
    if (user && projects.length) {
      for (const p of projects) p.warnings.push('shadowed by user skill');
      out.push({ invokeName, ids, note: 'user skill wins; project copy is shadowed' });
    } else if (others.length >= 2 || (others.length === 1 && projects.length)) {
      out.push({ invokeName, ids, note: 'same invoke name from several sources' });
    }
  }
  return out;
}
