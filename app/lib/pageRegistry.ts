// ──────────────────────────────────────────────────────────────────
// Page Registry — the SINGLE link between member_permissions and
// the home dashboard. Each entry maps a permission column to a card.
//
// To add a new page in the future:
//   1. Add a column to member_permissions (ALTER TABLE)
//   2. Add a permission check in permissions.ts
//   3. Add one entry here
// That's it — the card appears automatically for anyone with the perm.
// ──────────────────────────────────────────────────────────────────

export type PageCard = {
  permKey: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  group: string;
  badgeKey?: string;
};

export const GROUP_ORDER = [
  "Overview",
  "Finance",
  "Departments",
  "Operations",
  "Settings",
  "Preferences",
] as const;

export const GROUP_COLOURS: Record<string, string> = {
  Overview:   "#0F1720",
  Finance:    "#0F7B5F",
  Operations: "#3B4CCA",
  Departments:"#B4791F",
  Settings:   "#64748B",
  Preferences:"#64748B",
};

export const PAGE_REGISTRY: PageCard[] = [
  // ── Overview (always-visible items added via alwaysItems in SidebarLayout) ──
  { permKey: "can_view_pa_dashboard", title: "PA Dashboard", subtitle: "Tasks, notes, quick actions, delegations", href: "/pa", icon: "⚡", group: "Overview", badgeKey: "pa" },
  { permKey: "_my_minutes", title: "My Minutes", subtitle: "Meeting minutes you attended", href: "/my-minutes", icon: "🗒️", group: "Overview", badgeKey: "minutes" },
  { permKey: "_profile", title: "My Profile", subtitle: "Your account and preferences", href: "/profile", icon: "👤", group: "Overview" },

  // ── Finance ──
  { permKey: "can_view_guarantees", title: "Bank Facilities", subtitle: "Guarantees, pay orders & bank facility utilisation", href: "/finance/guarantees", icon: "🔐", group: "Finance" },
  { permKey: "can_view_finance_ifpl", title: "Imperial Footwear", subtitle: "Cash position, forecasts, budgets", href: "/finance/imperial", icon: "👞", group: "Finance", badgeKey: "ifplFinance" },
  { permKey: "can_view_investments", title: "Investments", subtitle: "PSX stock portfolio tracker", href: "/investments", icon: "📈", group: "Finance" },
  { permKey: "can_edit_finance", title: "Opening Balances", subtitle: "Set starting balances for companies", href: "/opening-balances", icon: "🏧", group: "Finance" },
  { permKey: "can_view_receivables", title: "Receivables", subtitle: "Track bills through collection stages", href: "/receivables", icon: "💳", group: "Finance", badgeKey: "receivables" },
  { permKey: "can_view_finance_utpl", title: "Unze Trading", subtitle: "Cash position, forecasts, budgets", href: "/finance/unze-trading", icon: "🏦", group: "Finance", badgeKey: "utplFinance" },

  // ── Departments ──
  { permKey: "can_view_dept_admin", title: "Admin", subtitle: "Administration dashboard", href: "/department/admin", icon: "🏛️", group: "Departments" },
  { permKey: "can_view_dept_audit", title: "Audit", subtitle: "Internal audit tracking", href: "/department/audit", icon: "🔎", group: "Departments", badgeKey: "audit" },
  { permKey: "can_view_dept_hr", title: "HR", subtitle: "Human resources dashboard", href: "/department/hr", icon: "🧑‍💼", group: "Departments" },
  { permKey: "can_view_dept_it", title: "IT", subtitle: "IT department dashboard", href: "/department/it", icon: "🖥️", group: "Departments" },
  { permKey: "can_view_dept_tax", title: "Taxation", subtitle: "Tax notices and compliance", href: "/department/taxation", icon: "🧾", group: "Departments" },
  { permKey: "can_view_dept_tax_accounts", title: "Accounts (Tax)", subtitle: "Quarterly accounts schedule and return filings", href: "/accounts-tax", icon: "📂", group: "Departments" },

  // ── Operations (alphabetical) ──
  { permKey: "_calendar", title: "Calendar", subtitle: "Tasks and deadlines view", href: "/calendar", icon: "🗓️", group: "Operations", badgeKey: "calendar" },
  { permKey: "can_access_daily_entry", title: "Daily Entry", subtitle: "Log daily production and dispatch", href: "/production", icon: "📊", group: "Operations" },
  { permKey: "can_manage_stock", title: "Manage POs", subtitle: "Create POs, contractors, authority letters", href: "/stock/manage", icon: "📋", group: "Operations" },
  { permKey: "can_see_all_minutes", title: "Meetings", subtitle: "Minutes, approvals, action items", href: "/meetings", icon: "💬", group: "Operations", badgeKey: "meetings" },
  { permKey: "can_view_operations_dashboard", title: "Operations Dashboard", subtitle: "Production, dispatch, stock, machines", href: "/dashboard", icon: "🏗️", group: "Operations", badgeKey: "operations" },
  { permKey: "can_manage_recurring_tasks", title: "Recurring Tasks", subtitle: "Manage recurring task templates", href: "/recurring-tasks", icon: "🔁", group: "Operations" },
  { permKey: "can_view_stock", title: "Stock", subtitle: "Customer POs, authority letters, dispatch balances", href: "/stock", icon: "🏭", group: "Operations" },
  { permKey: "_tasks", title: "Tasks", subtitle: "View and manage tasks", href: "/tasks", icon: "🎯", group: "Operations", badgeKey: "tasks" },

  // ── Settings ──
  { permKey: "can_view_members", title: "Members", subtitle: "Team members, roles, access", href: "/members", icon: "👥", group: "Settings", badgeKey: "members" },
  { permKey: "can_view_exceptions", title: "Exceptions", subtitle: "Exception management and alerts", href: "/exceptions", icon: "🚨", group: "Settings" },
  { permKey: "can_view_audit_log", title: "Audit Log", subtitle: "System activity trail", href: "/audit-log", icon: "📋", group: "Settings" },
  { permKey: "_admin_settings", title: "Data & Backups", subtitle: "Source documents, backups, restore", href: "/admin", icon: "🗄️", group: "Settings" },
];
