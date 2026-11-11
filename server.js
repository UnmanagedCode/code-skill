// Entry point: cc runs `npm start` with PORT, CONDUCTOR_URL, PROJECTS_ROOT and
// CONDUCTOR_PLUGIN_DATA_DIR set. Tests never import this file.
import { mkdirSync } from 'node:fs';
import { loadConfig } from './src/config.js';
import { createServer } from './src/app.js';
import { createConductorClient } from './src/conductorClient.js';

const config = loadConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });
createServer(config, { conductor: createConductorClient(config.conductorUrl) })
  .listen(config.port, config.host, () => console.log(`code-skill listening on http://${config.host}:${config.port}`));
