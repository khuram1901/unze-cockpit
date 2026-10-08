-- Migration 262: daily_entry_preview RPC
--
-- Purpose: Lightweight RPC for the /daily-sales form to compute live totals
--          (total_credit_card_sale, total_sale, net_cash_movement,
--           opening_balance, closing_balance) without writing any data.
--
-- Who can call: CEO / Admin (by role) OR any member with
--               can_access_daily_sales = true in member_permissions.
--
-- Why not import_preview? That RPC validates bulk-import batches and requires
-- the imperial.retail_sales widget. Store users have neither. This function
-- is the form-level preview for a single entry.
--
-- ROLLBACK (apply to undo):
--   DROP FUNCTION IF EXISTS public.daily_entry_preview(uuid, date, jsonb);

CREATE OR REPLACE FUNCTION public.daily_entry_preview(
  p_store_id  uuid,
  p_date      date,
  p_fields    jsonb   -- keys: cash_sale, campaign_float_cash, expenses,
                      --   other_income, deposit, allied_bank_cc_sale,
                      --   hbl_cc_sale, gift_karte, gift_vouchers, credit_notes_issue
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cash          numeric(14,2);
  v_float         numeric(14,2);
  v_expenses      numeric(14,2);
  v_other         numeric(14,2);
  v_deposit       numeric(14,2);
  v_allied        numeric(14,2);
  v_hbl           numeric(14,2);
  v_karte         numeric(14,2);
  v_vouchers      numeric(14,2);
  v_credit_notes  numeric(14,2);

  v_total_cc      numeric(14,2);
  v_total_sale    numeric(14,2);
  v_net_cash      numeric(14,2);
  v_opening_bal   numeric(14,2);
  v_closing_bal   numeric(14,2);

  v_has_access    boolean := false;
BEGIN
  -- Access check: CEO/Admin by role, or can_access_daily_sales
  SELECT
    EXISTS (
      SELECT 1 FROM public.members m
       WHERE lower(m.email) = lower(auth.email())
         AND m.role IN ('CEO', 'Admin')
    )
    OR EXISTS (
      SELECT 1 FROM public.member_permissions mp
      JOIN public.members m ON m.id = mp.member_id
       WHERE lower(m.email) = lower(auth.email())
         AND mp.can_access_daily_sales = true
    )
  INTO v_has_access;

  IF NOT v_has_access THEN
    RAISE EXCEPTION 'daily_entry_preview: access denied';
  END IF;

  -- Parse input fields (coerce nulls to 0)
  v_cash         := COALESCE((p_fields->>'cash_sale')::numeric,            0);
  v_float        := COALESCE((p_fields->>'campaign_float_cash')::numeric,  0);
  v_expenses     := COALESCE((p_fields->>'expenses')::numeric,             0);
  v_other        := COALESCE((p_fields->>'other_income')::numeric,         0);
  v_deposit      := COALESCE((p_fields->>'deposit')::numeric,              0);
  v_allied       := COALESCE((p_fields->>'allied_bank_cc_sale')::numeric,  0);
  v_hbl          := COALESCE((p_fields->>'hbl_cc_sale')::numeric,          0);
  v_karte        := COALESCE((p_fields->>'gift_karte')::numeric,           0);
  v_vouchers     := COALESCE((p_fields->>'gift_vouchers')::numeric,        0);
  v_credit_notes := COALESCE((p_fields->>'credit_notes_issue')::numeric,   0);

  -- Apply the same formulas as the daily_sales generated columns
  v_total_cc   := v_allied + v_hbl;
  v_total_sale := v_cash + v_total_cc + v_karte + v_vouchers - v_credit_notes;
  v_net_cash   := v_cash + v_float + v_other - v_expenses - v_deposit;

  -- Opening balance: store_opening_balances.amount + SUM(net_cash_movement)
  -- for all saved, non-deleted rows strictly BEFORE p_date.
  -- Mirrors the window function in daily_sales_computed exactly.
  -- Result is NULL (never 0) when no opening balance row exists.
  SELECT
    sob.amount + COALESCE(
      (SELECT SUM(ds2.net_cash_movement)
         FROM public.daily_sales ds2
        WHERE ds2.store_id = p_store_id
          AND ds2.sales_date < p_date
          AND ds2.deleted_at IS NULL),
      0
    )
  INTO v_opening_bal
  FROM public.store_opening_balances sob
  WHERE sob.store_id = p_store_id;
  -- NOT FOUND leaves v_opening_bal as NULL — correct per spec.

  v_closing_bal := CASE
    WHEN v_opening_bal IS NULL THEN NULL
    ELSE v_opening_bal + v_net_cash
  END;

  RETURN jsonb_build_object(
    'total_credit_card_sale', v_total_cc,
    'total_sale',             v_total_sale,
    'net_cash_movement',      v_net_cash,
    'opening_balance',        v_opening_bal,
    'closing_balance',        v_closing_bal
  );
END;
$$;

REVOKE ALL ON FUNCTION public.daily_entry_preview(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.daily_entry_preview(uuid, date, jsonb) TO authenticated;
