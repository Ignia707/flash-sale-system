// GET /api/sale: when the sale opens, by the server's clock (the browser's clock can be wrong)

import type { FastifyPluginAsync } from "fastify";
import { hasStarted, type Sale } from "../../lib/sale.ts";

export const saleRoutes =
  (sale: Sale): FastifyPluginAsync =>
  async (app) => {
    app.get("/api/sale", async () => ({
      open: hasStarted(sale),
      startsAt: sale.startsAt?.toISOString() ?? null,
      serverTime: new Date(sale.now()).toISOString(),
    }));
  };
