import { OVERRIDE_VALUES } from './settingsFile.js';
import { skillNameOf } from '../discovery/record.js';

// The layer chain that applies to a skill, in merge order (later wins).
export function chainFor(record, layers) {
  if (record.source === 'user') return [layers.user, ...layers.policy];
  const p = layers.perProject[record.owner.project];
  return [layers.user, ...(p ? [p.project, p.local] : []), ...layers.policy];
}

const valueIn = (layer, name) => {
  const v = layer.overrides[name];
  return OVERRIDE_VALUES.includes(v) ? v : undefined;
};

// → { effective, layers[], lockedByPolicy, otherProjects? } for a user or project skill,
// keyed (like the CLI) on the skill's name.
export function effectiveFor(record, layers) {
  const name = skillNameOf(record);
  const set = [];
  for (const layer of chainFor(record, layers)) {
    const value = valueIn(layer, name);
    if (value !== undefined) set.push({ layer: layer.layer, file: layer.file, value });
  }
  const result = {
    effective: set.length ? set[set.length - 1].value : 'on',
    layers: set,
    lockedByPolicy: set.some((s) => s.layer === 'policy'),
  };
  if (record.source === 'user') {
    // A user skill also runs in every project, where that project's layers apply.
    result.otherProjects = [];
    for (const [project, p] of Object.entries(layers.perProject)) {
      for (const layer of [p.project, p.local]) {
        const value = valueIn(layer, name);
        if (value !== undefined) result.otherProjects.push({ project, layer: layer.layer, value });
      }
    }
  }
  return result;
}
