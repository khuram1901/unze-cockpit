// Registry of individually-toggleable dashboard widgets/sections — the
// list the Access Matrix's page-element picker reads to render checkboxes,
// and the single source of truth for widget keys used in
// widgetVisible(ctx, key, defaultVisible) call sites around the app.
//
// Adding a new toggleable section = add an entry here + wrap the JSX with
// widgetVisible(...) at the call site. No migration needed — rows in
// member_widget_overrides are sparse (see supabase/136_widget_visibility.sql).

export type WidgetDef = {
  key: string;
  label: string;
  page: string; // grouping label shown in the matrix picker
  tip?: string;
  // Rendered once per company in FINANCE_COMPANIES (lib/constants.ts)
  // instead of once overall — the picker expands it into one row per
  // company, and the actual key used at runtime is `${key}.${companyId}`.
  // Adding a company to FINANCE_COMPANIES automatically gets a row here
  // for every perCompany widget — nothing else to update.
  perCompany?: boolean;
};

export const WIDGET_REGISTRY: WidgetDef[] = [
  // ── Executive Dashboard (app/home/page.tsx) ──────────────────────
  { key: "home.attention_banner", label: "Items Needing Attention", page: "Executive Dashboard", tip: "The overdue tasks / escalations / stuck receivables banner at the top of the page" },
  { key: "home.production_trend_chart", label: "Daily Production Trend", page: "Executive Dashboard", tip: "This month's produced/dispatched/broken line chart" },
  { key: "home.receipts_payments_chart", label: "Monthly Receipts vs Payments", page: "Executive Dashboard" },
  { key: "home.cash_flow_waterfall", label: "Cash Flow Waterfall", page: "Executive Dashboard", tip: "Opening → receipts → payments → closing, per company" },
  { key: "home.company_comparison", label: "Company Comparison", page: "Executive Dashboard", tip: "Side-by-side cash balance/receipts/payments — only ever appears when someone's scope covers 2+ companies" },
  { key: "home.finance_by_company", label: "Finance Panels (per company) — whole section", page: "Executive Dashboard", tip: "Master switch for the panel below; turn off to hide all of a company's finance cards at once regardless of the individual toggles" },
  { key: "home.receivables", label: "Receivables — Bills in Progress", page: "Executive Dashboard" },
  { key: "home.bank_facilities", label: "Bank Facilities", page: "Executive Dashboard" },
  { key: "home.tax_compliance", label: "Tax Compliance", page: "Executive Dashboard" },
  { key: "home.investments", label: "Investments — PSX Portfolio", page: "Executive Dashboard" },
  { key: "home.uk_pension", label: "UK Pension", page: "Executive Dashboard" },
  { key: "home.folderit", label: "Folder-it", page: "Executive Dashboard" },
  { key: "home.department_scorecard", label: "Department Scorecard", page: "Executive Dashboard", tip: "RAG status per department + task load chart" },
  { key: "home.preaudit_pending", label: "Pre-Audit Approvals (today)", page: "Executive Dashboard", tip: "Unapproved documents recorded daily by the pre-audit team — target zero" },

  // ── Unze P&L (app/finance/profit-and-loss/page.tsx) ──────────────
  { key: "unze_pnl.attention_banner", label: "Needs-attention banner", page: "Unze P&L" },
  { key: "unze_pnl.kpi_cards", label: "KPI cards", page: "Unze P&L" },
  { key: "unze_pnl.charts", label: "Charts (sales, bridge, margins, cost structure)", page: "Unze P&L" },
  { key: "unze_pnl.plant_scoreboard", label: "Plant scoreboard", page: "Unze P&L" },
  { key: "unze_pnl.expense_watch", label: "Expense watch", page: "Unze P&L" },
  { key: "unze_pnl.commentary", label: "CEO commentary (AI)", page: "Unze P&L" },
  { key: "unze_pnl.footer", label: "Data quality + market context footer", page: "Unze P&L" },

  // ── Imperial P&L (app/finance/imperial-pnl/page.tsx) ─────────────
  { key: "imperial_pnl.attention_banner", label: "Needs-attention banner", page: "Imperial P&L" },
  { key: "imperial_pnl.kpi_cards", label: "KPI cards", page: "Imperial P&L" },
  { key: "imperial_pnl.charts", label: "Charts (plan vs actual, profit, growth)", page: "Imperial P&L" },
  { key: "imperial_pnl.branch_league", label: "Branch league", page: "Imperial P&L" },
  { key: "imperial_pnl.expense_watch", label: "Expense watch", page: "Imperial P&L" },
  { key: "imperial_pnl.commentary", label: "CEO commentary (AI)", page: "Imperial P&L" },
  { key: "imperial_pnl.data_strip", label: "Data quality strip", page: "Imperial P&L" },

  // ── Operations Dashboard (app/dashboard/DashboardView.tsx) ───────
  { key: "dashboard.attention_banner", label: "Attention Needed banner", page: "Operations Dashboard", tip: "Machines down / plants not reported / overdue tasks alert" },
  { key: "dashboard.hero_kpi_cards", label: "Good Stock hero + KPI cards", page: "Operations Dashboard", tip: "The dark Good Stock card and the 5 compact KPI tiles beside it" },
  { key: "dashboard.this_month_charts", label: "This Month (charts)", page: "Operations Dashboard", tip: "Plant comparison and breakage rate charts" },
  { key: "dashboard.stock_by_customer_po", label: "Stock by Customer PO", page: "Operations Dashboard" },
  { key: "dashboard.kpis_table", label: "KPIs (tabbed detail)", page: "Operations Dashboard", tip: "Production/Dispatch/Breakage/Tasks tab switcher and table" },
  { key: "dashboard.monthly_targets", label: "Monthly Targets", page: "Operations Dashboard" },

  // ── Department dashboards (app/department/[slug]/*.tsx) ──────────
  { key: "dept_admin.attention_banner", label: "Alert banner", page: "Admin", tip: "Overdue/urgent items dropdown at the top" },
  { key: "dept_admin.kpi_charts", label: "KPI cards + charts", page: "Admin" },
  { key: "dept_admin.records_table", label: "Tasks by Company (table)", page: "Admin" },

  { key: "dept_audit.stuck_strip", label: "Where teams are stuck (strip)", page: "Audit", tip: "Manager-only strip flagging sub-tasks over day budget or idle 5+ days" },
  { key: "dept_audit.team_cards", label: "Team cards", page: "Audit", tip: "The three audit team cards (Unze / Imperial / Restaurants)" },
  { key: "dept_audit.plan_checklist", label: "Annual plan checklist", page: "Audit", tip: "The team's audit checklist with stage tracker" },
  { key: "dept_audit.daily_activities", label: "Pre-audit daily activities", page: "Audit", tip: "Reference panel of daily approvals" },

  { key: "dept_hr.attention_banner", label: "Alert banner", page: "HR", tip: "Overdue/urgent items dropdown at the top" },
  { key: "dept_hr.kpi_charts", label: "KPI cards + chart", page: "HR" },
  { key: "dept_hr.records_table", label: "Positions (table)", page: "HR" },

  { key: "dept_tax.attention_banner", label: "Alert banner", page: "Tax Notices", tip: "Overdue/urgent items dropdown at the top" },
  { key: "dept_tax.kpi_charts", label: "KPI cards + charts", page: "Tax Notices" },
  { key: "dept_tax.records_table", label: "Notices by Company (table)", page: "Tax Notices" },

  { key: "dept_it.kpi_charts", label: "KPI cards", page: "IT" },
  { key: "dept_it.records_table", label: "Records / Tasks table", page: "IT" },

  // ── Receivables (app/receivables/page.tsx) ────────────────────────
  { key: "receivables.kpi_cards", label: "KPI cards", page: "Receivables", tip: "Total Bills / Outstanding / Stuck / Collected" },
  { key: "receivables.stage_board", label: "Stage Board (kanban)", page: "Receivables" },
  { key: "receivables.collected_by_plant", label: "Collected Bills by Plant", page: "Receivables" },
  { key: "receivables.pipeline_summary", label: "Pipeline Stages (bar)", page: "Receivables" },
  { key: "receivables.collection_velocity", label: "Collection Velocity", page: "Receivables", tip: "Average days spent in each stage" },
  { key: "receivables.customer_summary", label: "Bills in Progress — by Customer", page: "Receivables" },
  { key: "receivables.aging_report", label: "Bill Aging Report", page: "Receivables" },

  // ── Accounts & Returns (app/accounts-tax/AccountsTaxDashboard.tsx) ─
  { key: "accounts_tax.attention_banner", label: "Items Need Attention", page: "Accounts & Returns", tip: "Overdue filings and accounts awaiting sign-off" },
  { key: "accounts_tax.compliance_summary", label: "Tax Compliance Summary", page: "Accounts & Returns" },
  { key: "accounts_tax.schedule", label: "Accounts Schedule", page: "Accounts & Returns", tip: "Quarterly accounts schedule, KPI cards and status table" },
  { key: "accounts_tax.filings", label: "Return Filings", page: "Accounts & Returns", tip: "Monthly/quarterly tax return filing status" },

  // ── Admin Operations (app/admin/page.tsx) ────────────────────────
  { key: "admin_ops.registrations", label: "Registrations tab", page: "Admin Operations", tip: "EOBI & Social Security registration status for all locations" },
  { key: "admin_ops.payments",      label: "Payments tab",      page: "Admin Operations", tip: "Monthly EOBI/SS payment tracking — missing and late payment alerts" },
  { key: "admin_ops.compliance",    label: "Compliance tab",    page: "Admin Operations", tip: "Licence and certificate renewals — civil defence, PFA, medical, fire" },
  { key: "admin_ops.documents",     label: "Documents tab",     page: "Admin Operations", tip: "NTN certificates and other location documents" },
  { key: "admin_ops.operations",    label: "Operations tab",    page: "Admin Operations", tip: "Fleet fuel tracking, vehicle maintenance, and solar site production" },

  // ── Bank Facilities (app/finance/guarantees/page.tsx) ─────────────
  // Ops chases guarantee releases and needs to see the list, but the PKR
  // figures (amounts, cash margin, bank charges, facility limits) are
  // normally Finance-only — canViewGuaranteeFinancials() computes the
  // role-based default (Admin/CEO or Finance manager), this widget lets
  // Khuram override that default per person on top, same as everywhere
  // else in the app.
  { key: "guarantees.financials", label: "Financial Figures (amounts, limits, margins)", page: "Bank Facilities", tip: "Guarantee amounts, cash margin, bank charges, facility limits & utilisation — all PKR figures. Defaults to Finance managers/Admin/CEO only; toggle to grant or deny it for a specific person." },

  // ── Finance panel cards, one row per company (app/home/page.tsx: CompanyFinancePanel) ──
  { key: "finance.cash_in_hand", label: "Cash in Hand", page: "Finance Panels", perCompany: true },
  { key: "finance.pdc_outstanding", label: "PDC Outstanding", page: "Finance Panels", perCompany: true },
  { key: "finance.money_in", label: "Money In (MTD)", page: "Finance Panels", perCompany: true },
  { key: "finance.money_out", label: "Money Out (MTD)", page: "Finance Panels", perCompany: true },
  { key: "finance.pdc_due_alert", label: "PDC Due Within 4 Weeks alert", page: "Finance Panels", perCompany: true },
  { key: "finance.forecast", label: "Forecast (month-end projection + breakdown)", page: "Finance Panels", perCompany: true },
  { key: "finance.plan_details", label: "Actual vs Plan Details", page: "Finance Panels", perCompany: true },
  { key: "finance.vs_last_year", label: "vs Same Month Last Year", page: "Finance Panels", perCompany: true },
];

export const WIDGET_PAGES = [...new Set(WIDGET_REGISTRY.map((w) => w.page))];
