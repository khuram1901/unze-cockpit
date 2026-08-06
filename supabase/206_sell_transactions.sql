-- Migration 206: sell_transactions table + realised gains RPCs
-- Apply via Supabase SQL Editor

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sell_transactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker        text        NOT NULL,
  company_name  text,
  quantity      numeric     NOT NULL CHECK (quantity > 0),
  sell_price    numeric     NOT NULL CHECK (sell_price >= 0),
  buy_price     numeric,    -- per-share buy price at time of sale
  sell_date     date        NOT NULL DEFAULT CURRENT_DATE,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Realised gain = (sell_price - buy_price) × quantity
-- Stored as a generated column so it's always consistent
ALTER TABLE sell_transactions
  ADD COLUMN IF NOT EXISTS realised_gain numeric
  GENERATED ALWAYS AS (quantity * (sell_price - COALESCE(buy_price, 0))) STORED;

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE sell_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sell_transactions' AND policyname = 'Authenticated full access'
  ) THEN
    CREATE POLICY "Authenticated full access"
      ON sell_transactions FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── RPC: overall summary ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_realised_gains_summary()
RETURNS TABLE (
  total_realised_gain numeric,
  transaction_count   bigint
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COALESCE(SUM(realised_gain), 0) AS total_realised_gain,
    COUNT(*)                         AS transaction_count
  FROM sell_transactions;
$$;

-- ── RPC: per-ticker breakdown ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_realised_gains_by_ticker()
RETURNS TABLE (
  ticker          text,
  company_name    text,
  qty_sold        numeric,
  avg_sell_price  numeric,
  avg_buy_price   numeric,
  realised_gain   numeric,
  last_sold       date
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ticker,
    MAX(company_name)                        AS company_name,
    SUM(quantity)                            AS qty_sold,
    ROUND(AVG(sell_price),            2)     AS avg_sell_price,
    ROUND(AVG(COALESCE(buy_price, 0)), 2)    AS avg_buy_price,
    SUM(realised_gain)                       AS realised_gain,
    MAX(sell_date)                           AS last_sold
  FROM sell_transactions
  GROUP BY ticker
  ORDER BY SUM(realised_gain) DESC;
$$;
