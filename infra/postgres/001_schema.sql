-- Database schema: products (stock) and orders.
-- IDEMPOTENT 

CREATE TABLE IF NOT EXISTS products (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  -- safety net: the database refuses negative stock
  stock INTEGER NOT NULL CHECK (stock >= 0)
);

CREATE TABLE IF NOT EXISTS orders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products (id),
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one product-item per user, enforced by the database
  UNIQUE (user_id, product_id)
);
