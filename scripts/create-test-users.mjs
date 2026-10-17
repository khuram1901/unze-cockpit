#!/usr/bin/env node
// scripts/create-test-users.mjs
// Creates / resets permanent test accounts for post-deploy testing.
// Reads credentials from .env.local — never prints secrets.
// Usage: node scripts/create-test-users.mjs [reset|grant|revoke|cleanup|status]
// Examples:
//   node scripts/create-test-users.mjs reset
//   node scripts/create-test-users.mjs grant imperial.retail_sales test.manager@unze.co.uk
//   node scripts/create-test-users.mjs revoke imperial.retail_sales test.manager@unze.co.uk
//   node scripts/create-test-users.mjs cleanup
//   node scripts/create-test-users.mjs status

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const PW_FILE = join(ROOT, '.test-user-pw');  // gitignored, stays local

// ── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(ROOT, '.env.local');
  const env = {};
  readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const headers = {
  'Content-Type': 'application/json',
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${url}\n${JSON.stringify(body, null, 2)}`);
  return body;
}

async function adminFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/auth/v1/admin${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`ADMIN ${res.status} ${path}\n${JSON.stringify(body, null, 2)}`);
  return body;
}

// ── Password management ──────────────────────────────────────────────────────
function getOrCreatePassword() {
  if (process.env.TEST_USER_PASSWORD) return process.env.TEST_USER_PASSWORD;
  if (existsSync(PW_FILE)) return readFileSync(PW_FILE, 'utf8').trim();
  const pw = randomBytes(20).toString('base64url').slice(0, 20);
  writeFileSync(PW_FILE, pw, { mode: 0o600 });
  console.log('✅  Generated new TEST_USER_PASSWORD and saved to .test-user-pw');
  console.log('⚠️   Copy that file\'s contents to Vercel env var TEST_USER_PASSWORD (Production + Preview).');
  return pw;
}

// ── Test user definitions ────────────────────────────────────────────────────
const TEST_USERS = [
  {
    email: 'test.member@unze.co.uk',
    role:  'Member',
    label: 'TEST ACCOUNT — Member (no widgets)',
    permissions: {},  // all false / defaults
  },
  {
    email: 'test.manager@unze.co.uk',
    role:  'Manager',
    label: 'TEST ACCOUNT — Manager',
    permissions: {
      can_view_finance: false,
      can_edit_finance: false,
      can_view_members: true,
      can_access_admin_ops: false,
    },
  },
  {
    email: 'test.ceo@unze.co.uk',
    role:  'Admin',
    label: 'TEST ACCOUNT — CEO/Admin (full access)',
    permissions: {
      can_view_executive_dashboard: true,
      can_view_operations_dashboard: true,
      can_view_finance: true,
      can_edit_finance: true,
      can_view_receivables: true,
      can_edit_receivables: true,
      can_see_all_tasks: true,
      can_create_tasks: true,
      can_review_tasks: true,
      can_manage_recurring_tasks: true,
      can_manage_calendar: true,
      can_see_all_minutes: true,
      can_view_dept_hr: true,
      can_view_dept_tax: true,
      can_view_dept_audit: true,
      can_view_dept_admin: true,
      can_view_dept_ops: true,
      can_view_dept_it: true,
      can_view_dept_legal: true,
      can_view_members: true,
      can_add_members: true,
      can_edit_members: true,
      can_delete_members: true,
      can_reset_passwords: true,
      can_view_audit_log: true,
      can_view_exceptions: true,
      can_import_export: true,
      can_access_daily_entry: true,
      can_view_investments: true,
      can_edit_investments: true,
      can_view_guarantees: true,
      can_manage_guarantees: true,
      can_view_stock: true,
      can_manage_stock: true,
      can_manage_meetings: true,
      can_manage_tax_notices: true,
      can_manage_tax_schedule: true,
      can_view_ifpl_pnl: true,
      can_edit_operations_targets: true,
      can_access_admin_ops: true,
      can_access_admin_entry: true,
      can_manage_locations: true,
      can_access_banking: true,
      can_view_restaurants_pnl: true,
      can_view_group_hr: true,
      can_view_hr_full_data: true,
      can_view_team_performance: true,
      can_access_daily_sales: true,
      folderit_can_view_utpl: true,
      folderit_can_view_ifpl: true,
      folderit_can_view_rst: true,
      folderit_can_view_smi: true,
      folderit_can_view_uzl: true,
      folderit_can_view_dir: true,
    },
  },
];

// ── Commands ─────────────────────────────────────────────────────────────────

async function cmdReset() {
  console.log('▶  Resetting all test-user widget overrides to OFF…');
  const emails = TEST_USERS.map(u => u.email);

  // Get member IDs for test users
  const rows = await sbFetch(`/rest/v1/members?email=in.(${emails.map(e => `"${e}"`).join(',')})&select=id,email`);
  if (!rows.length) { console.log('   No test members found in DB yet.'); return; }

  for (const row of rows) {
    await sbFetch(`/rest/v1/member_widget_overrides?member_id=eq.${row.id}`, {
      method: 'DELETE',
    });
    console.log(`   ✓ Cleared overrides for ${row.email}`);
  }
  console.log('✅  All test widget overrides cleared.');
}

async function cmdGrant(widgetKey, email) {
  if (!widgetKey || !email) { console.error('Usage: grant <widget_key> <email>'); process.exit(1); }
  const rows = await sbFetch(`/rest/v1/members?email=eq.${encodeURIComponent(email)}&select=id`);
  if (!rows.length) { console.error(`No member found: ${email}`); process.exit(1); }
  const memberId = rows[0].id;
  await sbFetch('/rest/v1/member_widget_overrides', {
    method: 'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ member_id: memberId, widget_key: widgetKey, visible: true }),
  });
  console.log(`✅  Granted widget "${widgetKey}" to ${email}`);
}

async function cmdRevoke(widgetKey, email) {
  if (!widgetKey || !email) { console.error('Usage: revoke <widget_key> <email>'); process.exit(1); }
  const rows = await sbFetch(`/rest/v1/members?email=eq.${encodeURIComponent(email)}&select=id`);
  if (!rows.length) { console.error(`No member found: ${email}`); process.exit(1); }
  const memberId = rows[0].id;
  await sbFetch(`/rest/v1/member_widget_overrides?member_id=eq.${memberId}&widget_key=eq.${encodeURIComponent(widgetKey)}`, {
    method: 'DELETE',
  });
  console.log(`✅  Revoked widget "${widgetKey}" from ${email}`);
}

async function cmdCleanup() {
  console.log('▶  Cleaning up test-created data (rows with test markers)…');
  // Reset all overrides
  await cmdReset();
  // Future: delete test-flagged records from other tables
  console.log('✅  Cleanup done. (Add table-specific cleanup here as needed.)');
}

async function cmdStatus() {
  const emails = TEST_USERS.map(u => u.email);
  const rows = await sbFetch(
    `/rest/v1/members?email=in.(${emails.map(e => `"${e}"`).join(',')})&select=id,email,role,is_active,notify_email,notify_whatsapp`
  );
  console.log('\nTest account status:');
  for (const u of TEST_USERS) {
    const row = rows.find(r => r.email === u.email);
    if (!row) { console.log(`  ✗  ${u.email} — NOT IN DB`); continue; }
    const overrides = await sbFetch(`/rest/v1/member_widget_overrides?member_id=eq.${row.id}&select=widget_key,visible`);
    console.log(`  ✓  ${u.email} (${row.role}) — active:${row.is_active} email_notif:${row.notify_email} overrides:[${overrides.map(o => `${o.widget_key}=${o.visible}`).join(', ')}]`);
  }
}

async function cmdCreate() {
  const pw = getOrCreatePassword();
  console.log('▶  Creating / updating 3 test auth users…');

  for (const u of TEST_USERS) {
    // 1. Check if auth user already exists
    let authUserId;
    try {
      const listResp = await adminFetch(`/users?email=${encodeURIComponent(u.email)}`);
      const existing = listResp.users?.find(x => x.email === u.email);
      if (existing) {
        // Always reset password so it stays in sync with .test-user-pw
        await adminFetch(`/users/${existing.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            password: pw,
            app_metadata: { test_user: true, must_change_password: false },
            user_metadata: { label: u.label },
          }),
        });
        authUserId = existing.id;
        console.log(`  ↻  ${u.email} — updated existing auth user`);
      }
    } catch (e) {
      // list may 404 if no results — create new
    }

    if (!authUserId) {
      const created = await adminFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: u.email,
          password: pw,
          email_confirm: true,
          app_metadata: { test_user: true, must_change_password: false },
          user_metadata: { label: u.label },
        }),
      });
      authUserId = created.id;
      console.log(`  ✓  ${u.email} — created auth user`);
    }

    // 2. Upsert members row
    const memberData = {
      id: authUserId,
      email: u.email,
      name: u.label,
      first_name: 'TEST',
      last_name: 'ACCOUNT',
      role: u.role,
      is_active: true,
      notify_email: false,
      notify_whatsapp: false,
    };
    await sbFetch('/rest/v1/members', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(memberData),
    });
    console.log(`     members row upserted`);

    // 3. Upsert member_permissions row
    const permData = { member_id: authUserId, ...u.permissions };
    await sbFetch('/rest/v1/member_permissions?on_conflict=member_id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(permData),
    });
    console.log(`     permissions row upserted`);
  }

  console.log('\n✅  All 3 test accounts ready.');
  if (!process.env.TEST_USER_PASSWORD) {
    console.log('\n⚠️   ACTION REQUIRED: Open .test-user-pw and update TEST_USER_PASSWORD in Vercel.');
    console.log('   (Production + Preview → paste the value from that file, then delete the file.)');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const [,, cmd, arg1, arg2] = process.argv;
switch (cmd) {
  case 'reset':   await cmdReset();               break;
  case 'grant':   await cmdGrant(arg1, arg2);     break;
  case 'revoke':  await cmdRevoke(arg1, arg2);    break;
  case 'cleanup': await cmdCleanup();             break;
  case 'status':  await cmdStatus();              break;
  case undefined:
  case 'create':  await cmdCreate();              break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error('Commands: create | reset | grant <widget> <email> | revoke <widget> <email> | cleanup | status');
    process.exit(1);
}
