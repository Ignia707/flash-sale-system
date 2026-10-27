// health endpoint - checks Postgres and Redis response

import type { FastifyPluginAsync } from "fastify";

// name -> a function that succeeds if that dependency is reachable
export type HealthChecks = Record<string, () => Promise<unknown>>;

const CHECK_TIMEOUT_MS = 2000;

// A dependency that hangs must not make /health hang too.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const healthRoutes =
  (checks: HealthChecks): FastifyPluginAsync =>
  async (app) => {
    app.get("/health", async (_request, reply) => {
      // run all checks at the same time, not one after another
      const results = await Promise.all(
        Object.entries(checks).map(async ([name, check]) => {
          try {
            await withTimeout(check(), CHECK_TIMEOUT_MS);
            return [name, "ok"] as const;
          } catch (err) {
            app.log.warn({ err, check: name }, "health check failed");
            return [name, "down"] as const;
          }
        }),
      );

      const healthy = results.every(([, status]) => status === "ok");

      // 503 tells load balancers "don't send traffic here"
      reply.code(healthy ? 200 : 503);
      return {
        status: healthy ? "ok" : "degraded",
        checks: Object.fromEntries(results),
      };
    });
  };
