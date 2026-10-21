import express, { type Express, type RequestHandler } from 'express';
import { authRouter, loadSession, meRouter, type AuthContext } from './auth.js';
import { errorHandler } from './http.js';
import { groupsRouter } from './groups.js';
import { dashboardRouter } from './dashboard.js';
import { invitesRouter, peopleRouter } from './invites.js';
import { soloRouter } from './solo.js';

/**
 * Requests that change data must be JSON. Browsers can't send cross-site JSON
 * without permission, so this (with SameSite cookies) blocks forged requests.
 * DELETE has no body, and browsers can't send it cross-site without permission either.
 */
const jsonOnlyForChanges: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method) || req.is('application/json')) return next();
  res.status(415).json({ error: { message: 'Requests that change data must be sent as JSON' } });
};

/** The JSON API. The page itself is added by index.ts (Vite in development, files in production). */
export function createApp(ctx: AuthContext): Express {
  const app = express();
  app.disable('x-powered-by');

  const api = express.Router();
  api.use(jsonOnlyForChanges);
  api.use(express.json({ limit: '1mb' }));
  api.use(loadSession(ctx));
  api.use('/auth', authRouter(ctx));
  api.use('/me', meRouter(ctx));
  api.use('/dashboard', dashboardRouter(ctx.pool));
  api.use('/solo-bills', soloRouter(ctx.pool));
  api.use('/groups', groupsRouter(ctx.pool));
  api.use('/people', peopleRouter(ctx.pool));
  api.use('/invites', invitesRouter(ctx.pool));
  api.use((_req, res) => {
    res.status(404).json({ error: { message: 'Not found' } });
  });
  api.use(errorHandler);

  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', api);
  return app;
}
