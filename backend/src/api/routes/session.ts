// POST /api/session: gives a new visitor a guest id and a signed token

import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";

const TOKEN_LIFETIME_SECONDS = 30 * 60;

export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/session", async () => {
    const userId = randomUUID();
    const token = app.jwt.sign(
      { sub: userId },
      { expiresIn: TOKEN_LIFETIME_SECONDS },
    );
    return { token, userId };
  });
};
