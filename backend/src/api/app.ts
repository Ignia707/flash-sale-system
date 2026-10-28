// BUILD the app

import Fastify from "fastify";
import {
  checkoutRoutes,
  type Publisher,
  type Reserver,
} from "./routes/checkout.ts";
import { healthRoutes, type HealthChecks } from "./routes/health.ts";

interface AppOptions {
  checks: HealthChecks;
  gate: Reserver;
  queue: Publisher;
  logger?: boolean;
}

export function buildApp({ checks, gate, queue, logger = false }: AppOptions) {
  const app = Fastify({
    logger,
    // reject unknown fields  - instead of silently dropping them (Fastify's default)
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.register(healthRoutes(checks));
  app.register(checkoutRoutes(gate, queue));

  return app;
}
