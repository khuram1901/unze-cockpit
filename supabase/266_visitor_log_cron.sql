-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 266 — Visitor Log pg_cron jobs
-- Requires pg_cron extension (already enabled on this project).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Auto-close at midnight PKT (UTC+5 → 19:00 UTC) ───────────────────────
-- Runs daily at 19:00 UTC = 00:00 PKT.
-- Any visit still open at midnight gets time_out set to midnight PKT.
SELECT cron.schedule(
  'visitor_auto_close_midnight',
  '0 19 * * *',   -- 19:00 UTC = 00:00 PKT
  $$
  UPDATE public.visitor_log
  SET
    time_out   = date_trunc('day', now() AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'Asia/Karachi'
                  + interval '23 hours 59 minutes',   -- 23:59 PKT today
    updated_at = now()
  WHERE time_out IS NULL
    AND NOT is_deleted
    AND visit_date < (now() AT TIME ZONE 'Asia/Karachi')::date;  -- previous days only
  $$
);

-- ── 2. Overstay notification every 15 minutes ────────────────────────────────
-- Calls the notify_overstay_visitors edge function (or pg_net if preferred).
-- We write to a notifications table that the bell icon polls.
SELECT cron.schedule(
  'visitor_overstay_check',
  '*/15 * * * *',
  $$
  INSERT INTO public.notifications (
    type, title, body, target_role, created_at
  )
  SELECT
    'visitor_overstay',
    'Visitor Overstay Alert',
    vl.visitor_name || ' has been with ' || vl.host_name
      || ' (' || vl.department_name || ') for '
      || ROUND(EXTRACT(EPOCH FROM (now() - vl.time_in))/60)::text || ' minutes.',
    'admin',
    now()
  FROM public.visitor_log vl
  JOIN public.visitor_settings vs ON vs.id = 1
  WHERE vl.time_out IS NULL
    AND NOT vl.is_deleted
    AND EXTRACT(EPOCH FROM (now() - vl.time_in))/60 > vs.overstay_threshold_mins
    -- Only fire once per 15-min window per visitor (avoid duplicates)
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.type = 'visitor_overstay'
        AND n.body LIKE '%' || vl.visitor_name || '%'
        AND n.created_at > now() - interval '15 minutes'
    );
  $$
);

-- ── 3. Weekly digest — Monday 07:00 PKT (02:00 UTC) ─────────────────────────
-- Inserts a weekly summary notification; the separate email sender
-- (existing notification infrastructure) picks it up and emails
-- akhlaq@unze.co.uk (stored in visitor_settings).
SELECT cron.schedule(
  'visitor_weekly_digest',
  '0 2 * * 1',    -- 02:00 UTC Monday = 07:00 PKT Monday
  $$
  WITH week_stats AS (
    SELECT
      COUNT(*)                                     AS total_visits,
      COUNT(DISTINCT COALESCE(cnic, mobile))       AS unique_visitors,
      COUNT(*) FILTER (WHERE time_out IS NULL
        AND visit_date = (now() AT TIME ZONE 'Asia/Karachi')::date - 1) AS still_inside,
      ROUND(AVG(CASE WHEN time_out IS NOT NULL THEN
        EXTRACT(EPOCH FROM (time_out - time_in))/60 END))               AS avg_duration_mins,
      COUNT(*) FILTER (WHERE purpose = 'Interview')                      AS interviews,
      COUNT(*) FILTER (WHERE purpose = 'Vendor/Payment')                 AS vendors,
      (SELECT weekly_digest_email FROM public.visitor_settings LIMIT 1)  AS digest_email
    FROM public.visitor_log
    WHERE NOT is_deleted
      AND visit_date >= (now() AT TIME ZONE 'Asia/Karachi')::date - 7
      AND visit_date <  (now() AT TIME ZONE 'Asia/Karachi')::date
  )
  INSERT INTO public.notifications (
    type, title, body, target_email, target_role, created_at
  )
  SELECT
    'visitor_weekly_digest',
    'Visitor Log — Weekly Digest',
    'Week ending ' || to_char((now() AT TIME ZONE 'Asia/Karachi')::date - 1, 'DD Mon YYYY') || E'\n'
    || 'Total visits: '     || total_visits     || E'\n'
    || 'Unique visitors: '  || unique_visitors   || E'\n'
    || 'Interviews: '       || interviews        || E'\n'
    || 'Vendor visits: '    || vendors           || E'\n'
    || 'Avg duration: '     || COALESCE(avg_duration_mins::text, '-') || ' mins',
    digest_email,
    'admin',
    now()
  FROM week_stats;
  $$
);
