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

  // ── Operations Dashboard (app/dashboard/DashboardView.tsx) ───────
  { key: "dashboard.attention_banner", label: "Attention Needed banner", page: "Operations Dashboard", tip: "Machines down / plants not reported / overdue tasks alert" },
  { key: "dashboard.hero_kpi_cards", label: "Good Stock hero + KPI cards", page: "Operations Dashboard", tip: "The dark Good Stock card and the 5 compact KPI tiles beside it" },
  { key: "dashboard.this_month_charts", label: "This Month (charts)", page: "Operations Dashboard", tip: "Plant comparison and breakage rate charts" },
  { key: "dashboard.stock_by_customer_po", label: "Stock by Customer PO", page: "Operations Dashboard" },
  { key: "dashboard.kpis_table", label: "KPIs (tabbed detail)", page: "Operations Dashboard", tip: "Production/Dispatch/Breakage/Tasks tab switcher and table" },
  { key: "dashboard.monthly_targets", label: "Monthly Targets", page: "Operations Dashboard" },

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
