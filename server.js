// Entry point: cc runs `npm start` with PORT, CONDUCTOR_URL, PROJECTS_ROOT and
// CONDUCTOR_PLUGIN_DATA_DIR set. It starts only when run directly, so importing
// it (a tool, a test) never reads the environment or opens a port.
import { mkdirSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './src/config.js';
import { createServer } from './src/app.js';
import { createConductorClient } from './src/conductorClient.js';

export function main(env) {
  const config = loadConfig(env);
  mkdirSync(config.dataDir, { recursive: true });
  createServer(config, { conductor: createConductorClient(config.conductorUrl) })
    .listen(config.port, config.host, () => console.log(`code-skill listening on http://${config.host}:${config.port}`));
}

const runDirectly = process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
if (runDirectly) main(process.env);
