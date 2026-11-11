import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildRoutes } from './http/routes.js';
import { serveUi } from './http/static.js';
import { securityHeaders } from './http/securityHeaders.js';
import { errorHandler } from './http/errorHandler.js';
import { createConductorClient } from './conductorClient.js';
import { createGitProbe } from './gitProbe.js';
import { createUsageIndex } from './usage/usageIndex.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// deps: { conductor?, git?, usage? } — real implementations when omitted.
export function createApp(config, deps = {}) {
  const full = {
    config,
    conductor: deps.conductor ?? createConductorClient(config.conductorUrl),
    git: deps.git ?? createGitProbe(),
    usage: deps.usage ?? createUsageIndex(config),
  };
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use('/api', buildRoutes(full));
  app.use(serveUi({ publicDir: path.join(REPO, 'public'), sharedDir: path.join(REPO, 'shared') }));
  app.use((req, res) => res.status(404).type('text/plain; charset=utf-8').send('Not found'));
  app.use(errorHandler);
  return app;
}

// An http.Server for the app; the caller listens.
export function createServer(config, deps) {
  return http.createServer(createApp(config, deps));
}
