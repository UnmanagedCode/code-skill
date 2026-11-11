import { promises as fs } from 'node:fs';
import path from 'node:path';

// Flat names only: no dots beyond the extension, so no traversal and no .map.
const FILE = '[A-Za-z0-9][A-Za-z0-9_-]*';
const ROUTES = [
  { re: new RegExp(`^/(${FILE}\\.(?:js|css))$`), dir: 'public', sub: '' },
  { re: new RegExp(`^/views/(${FILE}\\.js)$`), dir: 'public', sub: 'views' },
  { re: new RegExp(`^/shared/(${FILE}\\.js)$`), dir: 'shared', sub: '' },
];

// Serves `/` (index.html), public/*.{js,css}, public/views/*.js and shared/*.js,
// GET and HEAD only. Anything else falls through to the 404 — no SPA fallback,
// so the host's /pluginBridge.js and /pluginTheme.css 404 standalone. A file is
// served only when its real path lies inside its real root.
export function serveUi({ publicDir, sharedDir }) {
  const dirs = { public: publicDir, shared: sharedDir };
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let match = req.path === '/' ? { dir: 'public', sub: '', name: 'index.html' } : null;
    for (const r of ROUTES) {
      const m = match ? null : r.re.exec(req.path);
      if (m) match = { dir: r.dir, sub: r.sub, name: m[1] };
    }
    if (!match) return next();
    let root;
    let rel;
    try {
      root = await fs.realpath(dirs[match.dir]);
      rel = path.relative(root, await fs.realpath(path.join(root, match.sub, match.name)));
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return next();
      return next(e);
    }
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return next();
    res.sendFile(rel, { root, headers: { 'Cache-Control': 'no-store' }, dotfiles: 'deny' }, (err) => {
      if (!err || res.headersSent) return;
      if (err.code === 'ENOENT' || err.code === 'EISDIR' || err.status < 500) return next();
      next(err);
    });
  };
}
