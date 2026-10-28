// BUILD the app

import jwt from "@fastify/jwt";
import Fastify from "fastify";
import {
  checkoutRoutes,
  type Publisher,
  type Reserver,
} from "./routes/checkout.ts";
import { healthRoutes, type HealthChecks } from "./routes/health.ts";
import { ordersRoutes, type OrderReader } from "./routes/orders.ts";
import { saleRoutes } from "./routes/sale.ts";
import { sessionRoutes } from "./routes/session.ts";

interface AppOptions {
  checks: HealthChecks;
  gate: Reserver;
  queue: Publisher;
  orders: OrderReader;
  jwtSecret: string;
  saleStartsAt?: Date;
  now?: () => number;
  logger?: boolean;
}

export function buildApp({
  checks,
  gate,
  queue,
  orders,
  jwtSecret,
  saleStartsAt,
  now = Date.now,
  logger = false,
}: AppOptions) {
  const sale = { startsAt: saleStartsAt, now };
  const app = Fastify({
    logger,
    // reject unknown fields  - instead of silently dropping them (Fastify's default)
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.register(jwt, { secret: jwtSecret });

  app.register(healthRoutes(checks));
  app.register(sessionRoutes);
  app.register(saleRoutes(sale));
  app.register(checkoutRoutes(gate, queue, sale));
  app.register(ordersRoutes(orders));

  return app;
}
