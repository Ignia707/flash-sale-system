// Buying logic for the database.

import type { Pool } from "pg";

export type BuyResult = "confirmed" | "sold_out" | "already_bought";

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

// CORRECT: check and decrement in one statement, order insert in the same transaction.
export async function buyAtomic(
  pool: Pool,
  userId: string,
  productId: number,
): Promise<BuyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // stock check and the decrement are a single step
    const update = await client.query(
      "UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock > 0",
      [productId],
    );
    if (update.rowCount === 0) {
      await client.query("ROLLBACK");
      return "sold_out";
    }

    await client.query(
      "INSERT INTO orders (user_id, product_id, status) VALUES ($1, $2, 'confirmed')",
      [userId, productId],
    );
    await client.query("COMMIT");
    return "confirmed";
  } catch (err) {
    await client.query("ROLLBACK"); // also gives back the decremented stock
    if ((err as { code?: string }).code === "23505") return "already_bought"; // postgres unique constraint violation
    throw err;
  } finally {
    client.release();
  }
}
