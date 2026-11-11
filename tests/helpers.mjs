import { makeRoots } from './fixtures/roots.mjs';
import { startFakeConductor } from './fixtures/fakeConductor.mjs';
import { createServer } from '../src/app.js';

// A fake git probe: every path classifies as `g.status` (settable); records calls.
export function fakeGit(status = 'untracked') {
  const g = { calls: [], status, classify: async (projectPath, absPath) => { g.calls.push({ projectPath, absPath }); return g.status; } };
  return g;
}

// Fixture roots + fake cc (projects = the fixture's projA/projB unless given) + the app on port 0.
export async function boot(t, spec = {}, { conductor = {}, git = fakeGit() } = {}) {
  const roots = await makeRoots(t, spec);
  const fake = await startFakeConductor(t, { projects: roots.projects, ...conductor });
  const config = roots.config(fake.url);
  const server = createServer(config, { git });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const json = async (method, route, body) => {
    const res = await fetch(url + route, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  };
  return { url, roots, config, fake, git, json };
}

// deps for calling modules directly (no HTTP): real conductor client against the fake.
export async function depsFor(t, spec = {}, conductor = {}) {
  const { createConductorClient } = await import('../src/conductorClient.js');
  const roots = await makeRoots(t, spec);
  const fake = await startFakeConductor(t, { projects: roots.projects, ...conductor });
  const config = roots.config(fake.url);
  const git = fakeGit();
  return { roots, fake, config, git, deps: { config, conductor: createConductorClient(fake.url), git } };
}
