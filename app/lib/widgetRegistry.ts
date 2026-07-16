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
};

export const WIDGET_REGISTRY: WidgetDef[] = [
  // ── Executive Dashboard (app/home/page.tsx) ──────────────────────
  { key: "home.production_trend_chart", label: "Daily Production Trend", page: "Executive Dashboard", tip: "This month's produced/dispatched/broken line chart" },
  { key: "home.receipts_payments_chart", label: "Monthly Receipts vs Payments", page: "Executive Dashboard" },
  { key: "home.cash_flow_waterfall", label: "Cash Flow Waterfall", page: "Executive Dashboard", tip: "Opening → receipts → payments → closing, per company" },
  { key: "home.company_comparison", label: "Company Comparison", page: "Executive Dashboard", tip: "Side-by-side UTPL vs IFPL cash balance/receipts/payments" },
  { key: "home.finance_by_company", label: "Finance Panels (per company)", page: "Executive Dashboard", tip: "Cash in hand, PDC, money in/out cards for each company" },
  { key: "home.receivables", label: "Receivables — Bills in Progress", page: "Executive Dashboard" },
  { key: "home.bank_facilities", label: "Bank Facilities", page: "Executive Dashboard" },
  { key: "home.tax_compliance", label: "Tax Compliance", page: "Executive Dashboard" },
  { key: "home.investments", label: "Investments — PSX Portfolio", page: "Executive Dashboard" },
  { key: "home.uk_pension", label: "UK Pension", page: "Executive Dashboard" },
  { key: "home.folderit", label: "Folder-it", page: "Executive Dashboard" },
  { key: "home.department_scorecard", label: "Department Scorecard", page: "Executive Dashboard", tip: "RAG status per department + task load chart" },
];

export const WIDGET_PAGES = [...new Set(WIDGET_REGISTRY.map((w) => w.page))];
