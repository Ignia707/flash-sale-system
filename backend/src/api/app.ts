// BUILD the app

import Fastify from "fastify";
import { healthRoutes, type HealthChecks } from "./routes/health.ts";

interface AppOptions {
  checks: HealthChecks;
  logger?: boolean;
}

export function buildApp({ checks, logger = false }: AppOptions) {
  const app = Fastify({ logger });

  app.register(healthRoutes(checks));

  return app;
}
