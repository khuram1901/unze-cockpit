-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 264 — Visitor Log schema
-- Applied manually in Supabase SQL Editor on the feature/visitors branch.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── visitor_log ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visitor_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- When
  visit_date        date        NOT NULL,
  time_in           timestamptz NOT NULL,
  time_out          timestamptz,                        -- NULL = still inside

  -- Who is visiting
  visitor_name      text        NOT NULL,
  mobile            text        NOT NULL,               -- canonical +923XXXXXXXXX
  cnic              text,                               -- 13 digits no dashes, nullable

  -- Who they are visiting
  department_id     uuid        REFERENCES public.departments(id),
  department_name   text        NOT NULL,               -- denorm snapshot
  host_member_id    uuid        REFERENCES public.members(id),
  host_name         text        NOT NULL,               -- denorm snapshot

  -- Why
  purpose           text        NOT NULL,               -- chip value
  purpose_other     text,                               -- free text when purpose = 'Other'
  comments          text,

  -- Metadata
  entered_by        uuid        REFERENCES public.members(id),
  checked_out_by    uuid        REFERENCES public.members(id),
  is_deleted        boolean     NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  deleted_by        uuid        REFERENCES public.members(id),

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── visitor_flags — VIP / Blacklist ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visitor_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnic        text        NOT NULL,   -- 13 digits, no dashes
  flag_type   text        NOT NULL CHECK (flag_type IN ('vip','blacklist')),
  reason      text,
  created_by  uuid        REFERENCES public.members(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cnic, flag_type)
);

-- ── visitor_audit_log — edit trail ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.visitor_audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id    uuid        NOT NULL REFERENCES public.visitor_log(id),
  changed_by    uuid        REFERENCES public.members(id),
  change_type   text        NOT NULL,   -- 'update' | 'delete' | 'checkout'
  old_values    jsonb,
  new_values    jsonb,
  changed_at    timestamptz NOT NULL DEFAULT now()
);

-- ── visitor_settings — admin-configurable thresholds ────────────────────────
CREATE TABLE IF NOT EXISTS public.visitor_settings (
  id                      integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  overstay_threshold_mins integer NOT NULL DEFAULT 120,                   -- 2 hours
  office_open_hour        smallint NOT NULL DEFAULT 9,                    -- 09:00 PKT
  office_close_hour       smallint NOT NULL DEFAULT 18,                   -- 18:00 PKT
  weekly_digest_email     text     NOT NULL DEFAULT 'akhlaq@unze.co.uk',
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid    REFERENCES public.members(id)
);

INSERT INTO public.visitor_settings DEFAULT VALUES ON CONFLICT DO NOTHING;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_visitor_log_date     ON public.visitor_log (visit_date) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_visitor_log_cnic     ON public.visitor_log (cnic)       WHERE cnic IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitor_log_mobile   ON public.visitor_log (mobile);
CREATE INDEX IF NOT EXISTS idx_visitor_log_dept     ON public.visitor_log (department_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_visitor_log_host     ON public.visitor_log (host_member_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_visitor_log_time_out ON public.visitor_log (time_out)   WHERE time_out IS NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_visitor_flags_cnic   ON public.visitor_flags (cnic);

-- ── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_visitor_log_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_visitor_log_updated_at ON public.visitor_log;
CREATE TRIGGER trg_visitor_log_updated_at
  BEFORE UPDATE ON public.visitor_log
  FOR EACH ROW EXECUTE FUNCTION public.set_visitor_log_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.visitor_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_flags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_settings   ENABLE ROW LEVEL SECURITY;

-- visitor_log SELECT: admin/CEO bypass OR widget visible
CREATE POLICY "visitor_log_select"
  ON public.visitor_log FOR SELECT
  USING (
    NOT is_deleted
    AND (
      -- CEO / admin bypass — independent of widget toggle
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.user_id = auth.uid()
          AND m.role IN ('ceo','admin')
          AND m.active = true
      )
      OR
      -- Widget-visible members (admin_ops.visitors widget key)
      has_widget(auth.uid(), 'admin_ops.visitors')
    )
  );

-- visitor_log INSERT: any authenticated user with the visitor_entry widget
CREATE POLICY "visitor_log_insert"
  ON public.visitor_log FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.active = true
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
      )
      OR has_widget(auth.uid(), 'admin_ops.visitor_entry')
    )
  );

-- visitor_log UPDATE: admin/CEO or widget-visible
CREATE POLICY "visitor_log_update"
  ON public.visitor_log FOR UPDATE
  USING (
    NOT is_deleted
    AND (
      EXISTS (
        SELECT 1 FROM public.members m
        WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
      )
      OR has_widget(auth.uid(), 'admin_ops.visitors')
    )
  );

-- visitor_flags: admin/CEO only
CREATE POLICY "visitor_flags_select"
  ON public.visitor_flags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
    OR has_widget(auth.uid(), 'admin_ops.visitors')
  );

CREATE POLICY "visitor_flags_insert"
  ON public.visitor_flags FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
  );

CREATE POLICY "visitor_flags_update"
  ON public.visitor_flags FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
  );

CREATE POLICY "visitor_flags_delete"
  ON public.visitor_flags FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
  );

-- visitor_audit_log: read by admin/CEO + widget holders
CREATE POLICY "visitor_audit_select"
  ON public.visitor_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
    OR has_widget(auth.uid(), 'admin_ops.visitors')
  );

-- visitor_settings: read + write admin/CEO only
CREATE POLICY "visitor_settings_select"
  ON public.visitor_settings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
    OR has_widget(auth.uid(), 'admin_ops.visitors')
  );

CREATE POLICY "visitor_settings_update"
  ON public.visitor_settings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.members m
      WHERE m.user_id = auth.uid() AND m.role IN ('ceo','admin') AND m.active = true
    )
  );
