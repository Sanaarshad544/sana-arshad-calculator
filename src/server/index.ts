import path from 'node:path';
import express from 'express';
import { createApp } from './app.js';
import { loadConfig, projectRoot } from './config.js';
import { DB_DOWN_MESSAGE, canConnect, createPool, migrate } from './db.js';
import { tidyAttempts } from './limits.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  if (!(await canConnect(pool))) {
    console.error(DB_DOWN_MESSAGE);
    await pool.end().catch(() => {});
    process.exit(1);
  }
  const applied = await migrate(pool);
  if (applied.length > 0) console.log(`Database updated: ${applied.join(', ')}`);
  // Forget wrong-try counts nobody has touched for a day, now and every hour.
  const tidy = () => tidyAttempts(pool).catch(() => {});
  void tidy();
  setInterval(tidy, 60 * 60 * 1000).unref();

  const app = createApp({ pool, secret: config.sessionSecret, production: config.production });
  const root = projectRoot();

  if (config.production) {
    const clientDir = path.join(root, 'dist/client');
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    // Every other address is a page of the app.
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(root, 'vite.config.ts'),
      // Each dev server gets its own live-reload port, so two can run side by side.
      server: { middlewareMode: true, hmr: { port: config.port + 21000 } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(config.port, () => {
    console.log(`Bill Splitter is running at http://localhost:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
