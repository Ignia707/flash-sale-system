import { loadConfig } from '../lib/config.ts';
import { createPool } from '../lib/db.ts';
import { createRedis } from '../lib/redis.ts';
import { buildApp } from './app.ts';

const config = loadConfig();
const pool = createPool(config.postgres);
const redis = createRedis(config.redis);

const app = buildApp({
  logger: true,
  checks: {
    postgres: () => pool.query('SELECT 1'),
    redis: () => redis.ping(),
  },
});

// On Ctrl+C or a container stop: finish in-flight requests, then close
// connections, instead of cutting everything off mid-request.
async function shutdown(signal: string) {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  redis.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// 0.0.0.0 = accept connections from outside this process/container too
await app.listen({ port: config.api.port, host: '0.0.0.0' });
