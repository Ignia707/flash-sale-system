// GET /api/orders/:id: tells a customer the state of their order

import type { FastifyPluginAsync } from "fastify";
import type { OrderStore } from "../../lib/orders.ts";

// the route only needs statusOf(), so tests can pass a tiny fake
export type OrderReader = Pick<OrderStore, "statusOf">;

// a malformed id is turned away with a 400 before it reaches the database
const schema = {
  params: {
    type: "object",
    required: ["id"],
    properties: { id: { type: "string", format: "uuid" } },
  },
} as const;

export const ordersRoutes =
  (orders: OrderReader): FastifyPluginAsync =>
  async (app) => {
    app.get<{ Params: { id: string } }>(
      "/api/orders/:id",
      { schema },
      async (request) => {
        const { id } = request.params;
        return { orderId: id, status: await orders.statusOf(id) };
      },
    );
  };
