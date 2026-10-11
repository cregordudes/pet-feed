import path from 'node:path';
import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { makeCloudflareVerifier, resolveRuntimeConfig } from './access.js';
import { createApp } from './app.js';
import { openDatabase } from './db.js';

const config = resolveRuntimeConfig(process.env);
if (!config.ok) {
  console.error(config.message);
  process.exit(1);
}

const production = process.env.NODE_ENV === 'production';
if (production && !fs.existsSync(path.resolve('dist', 'index.html'))) {
  console.error('Missing dist/index.html. Run npm run build before npm start.');
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'feed.db');
const db = openDatabase(dbPath);
const verifyJwt = config.devMode
  ? async () => {
      throw new Error('Cloudflare Access is not configured.');
    }
  : makeCloudflareVerifier(config.teamDomain, config.audience);

const app = createApp(db, { devMode: config.devMode, verifyJwt, production });
const port = Number(process.env.PORT) || 8787;
const hostname = process.env.HOST || '0.0.0.0';

serve({ fetch: app.fetch, port, hostname }, (info) => {
  const mode = config.devMode ? 'development (Husband/Wife switch)' : 'Cloudflare Access';
  console.log(`Cats listening on ${info.address}:${info.port} — ${mode}`);
});
