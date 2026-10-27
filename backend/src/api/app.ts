import Fastify from 'fastify';
import { healthRoutes, type HealthChecks } from './routes/health.ts';

interface AppOptions {
  checks: HealthChecks;
  logger?: boolean;
}

// Builds the app but does not start listening. Keeping "build" separate from
// "start" lets tests create the app and call routes without opening a port.
export function buildApp({ checks, logger = false }: AppOptions) {
  const app = Fastify({ logger });

  app.register(healthRoutes(checks));

  return app;
}
