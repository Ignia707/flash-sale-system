// create connection pool for DB

import { Pool } from "pg";
import type { Config } from "./config.ts";

// a few open connections to reuse
export function createPool(config: Config["postgres"]): Pool {
  const pool = new Pool({
    ...config,
    max: 10, // hold at-most 10 connections
  });

  pool.on("error", (err) => {
    console.error("Unexpected Postgres pool error", err);
  });

  return pool;
}
