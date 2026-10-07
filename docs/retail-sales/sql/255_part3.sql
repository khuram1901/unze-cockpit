-- =============================================================================
-- MIGRATION 255 — PART 3 of 4
-- View (daily_sales_computed), attachments table, SECURITY DEFINER RPCs:
--   reopen_month, revoke_reopen, soft_delete_daily_sale, edit_daily_sale,
--   set_opening_balance, edit_opening_balance.
-- Depends on parts 1 + 2. Final 255 = parts 1–4 in one BEGIN/COMMIT.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. daily_sales_computed VIEW
--    security_invoker = true → underlying daily_sales RLS applies to callers.
--    opening_balance  = store_opening_balances.amount + SUM(net_cash_movement)
--                       for all prior active rows for the same store.
--    closing_balance  = opening_balance + net_cash_movement.
--    Both are NULL (never 0) when no opening balance row exists for the store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.daily_sales_computed
  WITH (security_invoker = true)
AS
SELECT
  ds.id,
  ds.store_id,
  ds.sales_date,
  ds.allied_bank_cc_sale,
  ds.hbl_cc_sale,
  ds.gift_karte,
  ds.credit_notes_issue,
  ds.gift_vouchers,
  ds.cash_sale,
  ds.campaign_float_cash,
  ds.expenses,
  ds.other_income,
  ds.deposit,
  ds.remarks,
  ds.total_credit_card_sale,
  ds.total_sale,
  ds.net_cash_movement,
  ds.status,
  ds.source,
  ds.import_batch_id,
  ds.submitted_by,
  ds.submitted_at,
  ds.updated_by,
  ds.updated_at,
  ds.deleted_at,
  ds.deleted_by,
  ds.delete_reason,
  ds.bank_reconciled,
  ds.sap_reconciled,
  ds.variance,
  -- opening_balance: NULL when no opening balance row; running sum of prior rows
  CASE
    WHEN sob.store_id IS NULL THEN NULL
    ELSE sob.amount + COALESCE(
      SUM(ds.net_cash_movement) OVER (
        PARTITION BY ds.store_id
        ORDER BY ds.sales_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0)
  END AS opening_balance,
  -- closing_balance: opening_balance + this row's net_cash_movement
  CASE
    WHEN sob.store_id IS NULL THEN NULL
    ELSE sob.amount + COALESCE(
      SUM(ds.net_cash_movement) OVER (
        PARTITION BY ds.store_id
        ORDER BY ds.sales_date
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ), 0)
  END AS closing_balance
FROM public.daily_sales ds
LEFT JOIN public.store_opening_balances sob ON sob.store_id = ds.store_id
WHERE ds.deleted_at IS NULL;

REVOKE ALL ON public.daily_sales_computed FROM anon;
GRANT SELECT ON public.daily_sales_computed TO authenticated;

-- ---------------------------------------------------------------------------
-- B. daily_sales_attachments
--    FK to daily_sales(id) ON DELETE CASCADE. Max 5 files per row (enforced
--    by trigger). Storage in bucket 'retail-sales'; direct uploads blocked.
-- ---------------------------------------------------------------------------
CREATE TABLE public.daily_sales_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_sale_id uuid       NOT NULL REFERENCES public.daily_sales(id) ON DELETE CASCADE,
  file_name    text        NOT NULL,
  storage_path text        NOT NULL,  -- path inside the 'retail-sales' bucket
  mime_type    text        NOT NULL,
  file_size    int         NOT NULL,
  uploaded_by  uuid        NOT NULL REFERENCES auth.users(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX daily_sales_attachments_sale_idx ON public.daily_sales_attachments (daily_sale_id);

ALTER TABLE public.daily_sales_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsa_select_widget ON public.daily_sales_attachments
  FOR SELECT TO authenticated USING (public.has_widget('imperial.retail_sales'));
CREATE POLICY dsa_select_own ON public.daily_sales_attachments
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.daily_sales ds
       WHERE ds.id = daily_sale_id
         AND ds.store_id = public.retail_store_for_user()
         AND ds.deleted_at IS NULL
    )
  );
REVOKE ALL ON public.daily_sales_attachments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.daily_sales_attachments FROM authenticated;

-- Enforce max 5 attachments per daily_sale row.
CREATE OR REPLACE FUNCTION public.daily_sales_attachments_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM public.daily_sales_attachments
   WHERE daily_sale_id = NEW.daily_sale_id;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'Maximum 5 attachments per daily sales row (store_id=%, sales_date=%)',
      (SELECT store_id  FROM public.daily_sales WHERE id = NEW.daily_sale_id),
      (SELECT sales_date FROM public.daily_sales WHERE id = NEW.daily_sale_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER daily_sales_attachments_limit
  BEFORE INSERT ON public.daily_sales_attachments
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_attachments_limit();

REVOKE ALL ON FUNCTION public.daily_sales_attachments_limit() FROM PUBLIC, anon;

-- AFTER INSERT audit on attachments
CREATE OR REPLACE FUNCTION public.daily_sales_attachments_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_id uuid;
  v_reason   text;
BEGIN
  SELECT store_id INTO v_store_id FROM public.daily_sales WHERE id = NEW.daily_sale_id;
  v_reason := current_setting('retail_sales.audit_reason', true);

  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('daily_sales_attachments', NEW.id, v_store_id, 'attach',
     NULL, to_jsonb(NEW), v_reason, auth.uid());

  RETURN NULL;
END;
$$;

CREATE TRIGGER daily_sales_attachments_audit_after
  AFTER INSERT ON public.daily_sales_attachments
  FOR EACH ROW EXECUTE FUNCTION public.daily_sales_attachments_audit_trigger();

REVOKE ALL ON FUNCTION public.daily_sales_attachments_audit_trigger() FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- C. reopen_month(p_store_id, p_month_start, p_until, p_reason)
--    HOD only (imperial.retail_sales_hod). p_store_id NULL = all stores.
--    p_until is mandatory — no indefinite reopens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reopen_month(
  p_store_id   uuid,
  p_month_start date,
  p_until      timestamptz,
  p_reason     text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlock_id uuid;
BEGIN
  -- Verify caller has HOD widget.
  IF NOT public.has_widget('imperial.retail_sales_hod') THEN
    RAISE EXCEPTION 'reopen_month requires the imperial.retail_sales_hod widget';
  END IF;

  -- p_month_start must be first of month.
  IF extract(day FROM p_month_start) <> 1 THEN
    RAISE EXCEPTION 'p_month_start must be the first day of a month (got %)', p_month_start;
  END IF;

  -- p_until must be in the future.
  IF p_until <= now() THEN
    RAISE EXCEPTION 'p_until must be in the future (got %)', p_until;
  END IF;

  -- p_reason must not be blank.
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to reopen a month';
  END IF;

  -- Insert the unlock record.
  INSERT INTO public.month_unlocks
    (store_id, month_start, reason, unlocked_by, unlocked_until)
  VALUES
    (p_store_id, p_month_start, p_reason, auth.uid(), p_until)
  RETURNING id INTO v_unlock_id;

  -- Audit row.
  PERFORM set_config('retail_sales.audit_reason', p_reason, true);
  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('month_unlocks', v_unlock_id, p_store_id, 'reopen',
     NULL,
     jsonb_build_object(
       'month_start', p_month_start,
       'unlocked_until', p_until,
       'store_id', p_store_id
     ),
     p_reason, auth.uid());

  RETURN v_unlock_id;
END;
$$;
REVOKE ALL ON FUNCTION public.reopen_month(uuid, date, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_month(uuid, date, timestamptz, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- D. revoke_reopen(p_unlock_id, p_reason)
--    HOD only. Sets revoked_at; cannot be undone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_reopen(
  p_unlock_id uuid,
  p_reason    text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unlock public.month_unlocks;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales_hod') THEN
    RAISE EXCEPTION 'revoke_reopen requires the imperial.retail_sales_hod widget';
  END IF;

  SELECT * INTO v_unlock FROM public.month_unlocks WHERE id = p_unlock_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Month unlock % not found', p_unlock_id;
  END IF;
  IF v_unlock.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Month unlock % is already revoked', p_unlock_id;
  END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to revoke a reopen';
  END IF;

  UPDATE public.month_unlocks
     SET revoked_at = now(), revoked_by = auth.uid()
   WHERE id = p_unlock_id;

  INSERT INTO public.daily_sales_audit
    (table_name, record_id, store_id, action, old_data, new_data, reason, changed_by)
  VALUES
    ('month_unlocks', p_unlock_id, v_unlock.store_id, 'revoke_reopen',
     to_jsonb(v_unlock),
     jsonb_build_object('revoked_at', now(), 'revoked_by', auth.uid()),
     p_reason, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_reopen(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_reopen(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- E. soft_delete_daily_sale(p_id, p_reason)
--    HOD only. Sets retail_sales.soft_delete_mode = 'true' (transaction-local)
--    so the BEFORE UPDATE trigger allows deleted_* fields to be set.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soft_delete_daily_sale(
  p_id     uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.daily_sales;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales_hod') THEN
    RAISE EXCEPTION 'soft_delete_daily_sale requires the imperial.retail_sales_hod widget';
  END IF;

  SELECT * INTO v_row FROM public.daily_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily_sales row % not found', p_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'daily_sales row % is already soft-deleted', p_id;
  END IF;
  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to soft-delete a daily sales row';
  END IF;

  -- Set session locals consumed by the triggers.
  PERFORM set_config('retail_sales.soft_delete_mode', 'true', true);
  PERFORM set_config('retail_sales.audit_reason', p_reason, true);

  UPDATE public.daily_sales
     SET deleted_at    = now(),
         deleted_by    = auth.uid(),
         delete_reason = p_reason
   WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.soft_delete_daily_sale(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_daily_sale(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- F. edit_daily_sale(p_id, …allowed fields)
--    Widget users only. Cannot change immutable fields (enforced by BEFORE UPDATE
--    trigger). Cannot change deleted_* (also enforced by trigger). Writes audit row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_daily_sale(
  p_id                 uuid,
  p_allied_bank_cc_sale numeric(14,2) DEFAULT NULL,
  p_hbl_cc_sale         numeric(14,2) DEFAULT NULL,
  p_gift_karte          numeric(14,2) DEFAULT NULL,
  p_credit_notes_issue  numeric(14,2) DEFAULT NULL,
  p_gift_vouchers       numeric(14,2) DEFAULT NULL,
  p_cash_sale           numeric(14,2) DEFAULT NULL,
  p_campaign_float_cash numeric(14,2) DEFAULT NULL,
  p_expenses            numeric(14,2) DEFAULT NULL,
  p_other_income        numeric(14,2) DEFAULT NULL,
  p_deposit             numeric(14,2) DEFAULT NULL,
  p_remarks             text          DEFAULT NULL,
  p_reason              text          DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.daily_sales;
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'edit_daily_sale requires the imperial.retail_sales widget';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required when editing a daily sales row';
  END IF;

  SELECT * INTO v_row FROM public.daily_sales WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'daily_sales row % not found', p_id;
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit a soft-deleted daily sales row (id=%)', p_id;
  END IF;

  PERFORM set_config('retail_sales.audit_reason', p_reason, true);

  UPDATE public.daily_sales SET
    allied_bank_cc_sale  = COALESCE(p_allied_bank_cc_sale,  allied_bank_cc_sale),
    hbl_cc_sale          = COALESCE(p_hbl_cc_sale,          hbl_cc_sale),
    gift_karte           = COALESCE(p_gift_karte,           gift_karte),
    credit_notes_issue   = COALESCE(p_credit_notes_issue,   credit_notes_issue),
    gift_vouchers        = COALESCE(p_gift_vouchers,        gift_vouchers),
    cash_sale            = COALESCE(p_cash_sale,            cash_sale),
    campaign_float_cash  = COALESCE(p_campaign_float_cash,  campaign_float_cash),
    expenses             = COALESCE(p_expenses,             expenses),
    other_income         = COALESCE(p_other_income,         other_income),
    deposit              = COALESCE(p_deposit,              deposit),
    remarks              = COALESCE(p_remarks,              remarks),
    status               = CASE WHEN status = 'submitted' THEN 'edited' ELSE status END
  WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_daily_sale(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_daily_sale(uuid, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- G. set_opening_balance(p_store_id, p_amount, p_opening_date, p_notes)
--    Widget users only. Inserts a new opening balance row (one per store).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_opening_balance(
  p_store_id    uuid,
  p_amount      numeric(14,2),
  p_opening_date date DEFAULT '2026-09-01',
  p_notes       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'set_opening_balance requires the imperial.retail_sales widget';
  END IF;

  PERFORM set_config('retail_sales.audit_reason', 'Initial opening balance set', true);

  INSERT INTO public.store_opening_balances
    (store_id, opening_date, amount, source, notes, set_by)
  VALUES
    (p_store_id, p_opening_date, p_amount, 'manual', p_notes, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.set_opening_balance(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_opening_balance(uuid, numeric, date, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- H. edit_opening_balance(p_store_id, p_amount, p_opening_date, p_reason, p_notes)
--    Widget users only. Reason required.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.edit_opening_balance(
  p_store_id     uuid,
  p_amount       numeric(14,2),
  p_opening_date date,
  p_reason       text,
  p_notes        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_widget('imperial.retail_sales') THEN
    RAISE EXCEPTION 'edit_opening_balance requires the imperial.retail_sales widget';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) = 0 THEN
    RAISE EXCEPTION 'A reason is required to edit an opening balance';
  END IF;

  PERFORM set_config('retail_sales.audit_reason', p_reason, true);

  UPDATE public.store_opening_balances
     SET amount       = p_amount,
         opening_date = p_opening_date,
         notes        = p_notes,
         updated_by   = auth.uid(),
         updated_at   = now()
   WHERE store_id = p_store_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No opening balance found for store %. Use set_opening_balance() first.', p_store_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_opening_balance(uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_opening_balance(uuid, numeric, date, text, text) TO authenticated;

-- END OF PART 3
