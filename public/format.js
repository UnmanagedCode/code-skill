// Display formatting shared by the views.

export const num = (n) => Number(n ?? 0).toLocaleString('en-US');
export const tokens = (n) => `~${num(n)}`;

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function contextLabel(t) {
  return t >= 1_000_000 && t % 1_000_000 === 0 ? `${t / 1_000_000}M` : `${Math.round(t / 1000)}k`;
}

export function ago(iso, now = Date.now()) {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const units = [[60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let v = s / 60;
  for (const [step, unit] of units) {
    if (v < step) {
      const r = Math.floor(v);
      return `${r} ${unit}${r === 1 ? '' : 's'} ago`;
    }
    v /= step;
  }
  return iso;
}

export const SOURCE_LABELS = Object.freeze({
  user: 'User', project: 'Project', synced: 'claude.ai', 'host-plugin': 'CC plugin', 'cc-core': 'cc core', 'cc-plugin': 'cc plugin', convention: 'Convention',
});
