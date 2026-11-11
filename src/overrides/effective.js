import { OVERRIDE_VALUES } from './settingsFile.js';
import { skillNameOf } from '../discovery/record.js';
import { SYNCED_NAMESPACE } from '../discovery/synced.js';

// The layer chain that applies to a skill, in merge order (later wins).
export function chainFor(record, layers) {
  if (record.source === 'user' || record.source === 'synced') return [layers.user, ...layers.policy];
  const p = layers.perProject[record.owner.project];
  return [layers.user, ...(p ? [p.project, p.local] : []), ...layers.policy];
}

// The skillOverrides keys that decide a skill, primary first. A synced skill is
// keyed on its namespaced name, which beats the bare alias; the bare name is
// honoured by the CLI unless it is reserved (approximated: a user skill has that name).
export function overrideKeysOf(record, userSkillNames = new Set()) {
  const name = skillNameOf(record);
  if (record.source !== 'synced') return [name];
  return [`${SYNCED_NAMESPACE}:${name}`, ...(userSkillNames.has(name) ? [] : [name])];
}

const valueIn = (layer, key) => {
  const v = layer.overrides[key];
  return OVERRIDE_VALUES.includes(v) ? v : undefined;
};

const severity = (v) => OVERRIDE_VALUES.indexOf(v);

// → { effective, layers[], lockedByPolicy, otherProjects? } for a user, project or synced skill.
// `keys` = overrideKeysOf(record); the first is primary. The last hit on the primary
// key wins, else the last on an alias; a policy layer's alias value may then raise it.
export function effectiveFor(record, layers, keys = overrideKeysOf(record)) {
  const [primary, ...aliases] = keys;
  const chain = chainFor(record, layers);
  const hits = [];
  for (const layer of chain) {
    for (const key of keys) {
      const value = valueIn(layer, key);
      if (value !== undefined) hits.push({ layer: layer.layer, file: layer.file, key, value });
    }
  }
  const last = (pred) => hits.filter(pred).at(-1)?.value;
  let effective = last((h) => h.key === primary) ?? last((h) => aliases.includes(h.key)) ?? 'on';
  const policyLayers = new Set(layers.policy.map((l) => l.file));
  for (const h of hits) {
    const policyHasPrimary = hits.some((o) => o.file === h.file && o.key === primary);
    if (policyLayers.has(h.file) && h.key !== primary && !policyHasPrimary && severity(h.value) > severity(effective)) effective = h.value;
  }
  const result = {
    effective,
    layers: hits,
    lockedByPolicy: hits.some((h) => h.layer === 'policy'),
  };
  if (record.source === 'user' || record.source === 'synced') {
    // Such a skill also runs in every project, where that project's layers apply.
    result.otherProjects = [];
    for (const [project, p] of Object.entries(layers.perProject)) {
      for (const layer of [p.project, p.local]) {
        for (const key of keys) {
          const value = valueIn(layer, key);
          if (value !== undefined) result.otherProjects.push({ project, layer: layer.layer, key, value });
        }
      }
    }
  }
  return result;
}
