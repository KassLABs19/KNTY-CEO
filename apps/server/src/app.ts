import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import { registerAuthRoutes } from './auth/routes.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerRequestRoutes } from './routes/requests.js';
import { registerPeopleRoutes } from './routes/people.js';
import { registerIntegrationRoutes } from './integration/routes.js';
import type { LicenceState } from './licence.js';

export async function buildApp(db: Db, config: Config, licence: () => LicenceState, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  await app.register(rateLimit, { global: false });
  await app.register(cors, {
    // The packaged desktop app loads from app://ceo; add others (such as the dev server) in CORS_ORIGINS.
    origin: ['app://ceo', ...config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)],
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cache-Control', 'no-store');
  });

  // Self-hosted servers with an expired or invalid licence keep working read-only.
  // Messages from partner systems still arrive, so nothing is lost while it is renewed.
  app.addHook('preHandler', async (req, reply) => {
    const state = licence();
    const readOnly = state.status === 'expired' || state.status === 'invalid';
    const allowed = req.method === 'GET' || req.url.startsWith('/api/auth/') || req.url.startsWith('/api/integration/');
    if (readOnly && !allowed) {
      return reply.status(402).send({ error: 'licence', message: 'The licence for this server has expired or is invalid. Changes are paused until it is renewed.' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.status(400).send({ error: 'invalid_request', message: err.issues[0]?.message ?? 'The request is not valid.' });
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.code ?? 'error', message: e.message ?? 'The request is not valid.' });
    req.log.error(err);
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong on the server. Try again; if it keeps happening, tell your administrator.' });
  });

  registerAuthRoutes(app, db, config);
  registerCoreRoutes(app, db, config, licence);
  registerRequestRoutes(app, db, config);
  registerPeopleRoutes(app, db, config);
  await registerIntegrationRoutes(app, db);

  return app;
}
