import { Refusal } from './safety/errors.js';

const TIMEOUT_MS = 5000;

// The cc REST surface Code Skill reads (no auth on loopback). An unreachable cc
// is a 502 CONDUCTOR_UNREACHABLE refusal; a non-2xx answer is a plain error
// naming the route, which callers turn into a source error.
export function createConductorClient(baseUrl) {
  const get = async (route) => {
    let res;
    try {
      res = await fetch(new URL(route, baseUrl), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new Refusal('CONDUCTOR_UNREACHABLE', 502, `code-conductor is unreachable at ${baseUrl} (${e.cause?.code ?? e.message})`);
    }
    if (!res.ok) throw new Error(`code-conductor ${route} answered ${res.status}`);
    return res.json();
  };
  return {
    listProjects: () => get('/api/projects'),
    listPlugins: async () => (await get('/api/plugins')).rows ?? [],
    listWorktrees: (project) => get(`/api/projects/${encodeURIComponent(project)}/worktrees`),
    listInstances: () => get('/api/instances'),
  };
}
