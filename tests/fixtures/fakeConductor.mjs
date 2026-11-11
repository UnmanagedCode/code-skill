// A fake cc REST server: /api/projects, /api/plugins, /api/projects/:n/worktrees, /api/instances.
// `state` is live: tests mutate it between requests. `state.fail[route] = status` makes a route fail;
// `state.onRequest(pathname)` (async) runs before each answer, e.g. to act inside a server-side window.
import http from 'node:http';

export async function startFakeConductor(t, state = {}) {
  const s = { projects: [], plugins: [], worktrees: {}, instances: [], fail: {}, ...state };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (s.onRequest) await s.onRequest(url.pathname);
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (s.fail[url.pathname]) return send(s.fail[url.pathname], { error: 'fake failure' });
    if (url.pathname === '/api/projects') return send(200, s.projects);
    if (url.pathname === '/api/plugins') return send(200, { rows: s.plugins, notices: [] });
    if (url.pathname === '/api/instances') return send(200, s.instances);
    const wt = /^\/api\/projects\/([^/]+)\/worktrees$/.exec(url.pathname);
    if (wt) return send(200, s.worktrees[decodeURIComponent(wt[1])] ?? []);
    send(404, { error: 'no route' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const close = () => new Promise((r) => server.close(r));
  if (t) t.after(close);
  return { url: `http://127.0.0.1:${server.address().port}`, state: s, close };
}
