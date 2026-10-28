// Demo: many buyers at once. Usage: pnpm demo:oversell [naive|atomic]

import { loadConfig } from "../lib/config.ts";
import { createPool } from "../lib/db.ts";
import { buyAtomic, buyNaive } from "../lib/inventory.ts";

const STOCK = 500;
const BUYERS = 10000;

const mode = process.argv[2] === "atomic" ? "atomic" : "naive";
const buy = mode === "atomic" ? buyAtomic : buyNaive;

const pool = createPool(loadConfig().postgres);

try {
  await pool.query("DELETE FROM orders");
  await pool.query("DELETE FROM products");
  const { rows } = await pool.query(
    "INSERT INTO products (name, stock) VALUES ('phone', $1) RETURNING id",
    [STOCK],
  );
  const productId: number = rows[0].id;

  // all buyers start at the same moment
  const started = Date.now();
  await Promise.all(
    Array.from({ length: BUYERS }, (_, i) => buy(pool, `user-${i}`, productId)),
  );
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  const orders = await pool.query("SELECT count(*)::int AS n FROM orders");
  const product = await pool.query("SELECT stock FROM products WHERE id = $1", [
    productId,
  ]);

  console.log(`mode:                ${mode}`);
  console.log(`stock at start:      ${STOCK}`);
  console.log(`buyers:              ${BUYERS}`);
  console.log(`orders confirmed:    ${orders.rows[0].n}`);
  console.log(`stock left in DB:    ${product.rows[0].stock}`);
  console.log(`OVERSOLD BY:         ${Math.max(0, orders.rows[0].n - STOCK)}`);
  console.log(`time:                ${seconds}s`);
} finally {
  await pool.query("DELETE FROM orders");
  await pool.query("DELETE FROM products");
  await pool.end();
}
