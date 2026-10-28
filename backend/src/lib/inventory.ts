// Buying logic for the database.

import type { Pool } from "pg";

// WRONG ON PURPOSE: read, decide in app code, write back. Kept to demo the oversell bug.
export async function buyNaive(
  pool: Pool,
  userId: string,
  productId: number,
): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT stock FROM products WHERE id = $1",
    [productId],
  );
  const stock = rows[0]?.stock;
  if (stock === undefined || stock <= 0) return false;

  // gap between read and write: others may have read the same stock
  await pool.query("UPDATE products SET stock = $1 WHERE id = $2", [
    stock - 1,
    productId,
  ]);
  await pool.query(
    "INSERT INTO orders (user_id, product_id, status) VALUES ($1, $2, 'confirmed')",
    [userId, productId],
  );
  return true;
}
