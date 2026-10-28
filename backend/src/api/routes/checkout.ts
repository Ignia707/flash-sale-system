// POST /api/checkout: asks the Redis gate for a token, queues the order, answers immediately

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Gate, ReserveResult } from "../../lib/gate.ts";
import type { OrderQueue } from "../../lib/queue.ts";

// the route only needs reserve(), so tests can pass a tiny fake
export type Reserver = Pick<Gate, "reserve">;
export type Publisher = Pick<OrderQueue, "publish">;

const STATUS_CODE = {
  reserved: 202, // Accepted
  already_reserved: 409, // Conflict
  sold_out: 410, // Gone
} as const satisfies Record<ReserveResult, number>;

// Fastify rejects requests that don't match - with a 400, prior to code run
const schema = {
  headers: {
    type: "object",
    required: ["x-user-id"],
    properties: {
      "x-user-id": { type: "string", minLength: 1, maxLength: 64 },
    },
  },
  body: {
    type: "object",
    required: ["productId"],
    properties: { productId: { type: "integer", minimum: 1 } },
    additionalProperties: false,
  },
} as const;

export const checkoutRoutes =
  (gate: Reserver, queue: Publisher): FastifyPluginAsync =>
  async (app) => {
    app.post<{
      Body: { productId: number };
      Headers: { "x-user-id": string };
    }>("/api/checkout", { schema }, async (request, reply) => {
      const { productId } = request.body;
      const userId = request.headers["x-user-id"];

      const result = await gate.reserve(productId, userId);

      // only a token holder gets an order - undefined is left out of the JSON
      let orderId: string | undefined;
      if (result === "reserved") {
        orderId = randomUUID();
        await queue.publish({ orderId, userId, productId });
      }

      reply.code(STATUS_CODE[result]);
      return { status: result, orderId };
    });
  };
