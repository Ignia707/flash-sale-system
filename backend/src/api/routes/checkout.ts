// POST /api/checkout: asks the Redis gate for a token and answers immediately

import type { FastifyPluginAsync } from "fastify";
import type { Gate, ReserveResult } from "../../lib/gate.ts";

// the route only needs reserve(), so tests can pass a tiny fake
export type Reserver = Pick<Gate, "reserve">;

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
  (gate: Reserver): FastifyPluginAsync =>
  async (app) => {
    app.post<{
      Body: { productId: number };
      Headers: { "x-user-id": string };
    }>("/api/checkout", { schema }, async (request, reply) => {
      const { productId } = request.body;
      const userId = request.headers["x-user-id"];

      const result = await gate.reserve(productId, userId);

      reply.code(STATUS_CODE[result]);
      return { status: result };
    });
  };
