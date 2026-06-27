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
  "Command Centre",
  "Finance",
  "Operations",
  "Tasks & Meetings",
  "Departments",
  "Settings",
] as const;

export const GROUP_COLOURS: Record<string, string> = {
  "Command Centre": "#0f172a",
  Finance: "#16a34a",
  Operations: "#2563eb",
  "Tasks & Meetings": "#d97706",
  Departments: "#7c3aed",
  Settings: "#64748b",
};

export const PAGE_REGISTRY: PageCard[] = [
  // ── Command Centre ──
  { permKey: "can_view_executive_dashboard", title: "Executive Dashboard", subtitle: "Full company overview — operations, finance, tasks", href: "/executive", icon: "📊", group: "Command Centre", badgeKey: "executive" },
  { permKey: "can_view_pa_dashboard", title: "PA Dashboard", subtitle: "Tasks, notes, quick actions, delegations", href: "/pa", icon: "📋", group: "Command Centre", badgeKey: "pa" },
  { permKey: "can_view_operations_dashboard", title: "Operations Dashboard", subtitle: "Production, dispatch, stock, machines", href: "/dashboard", icon: "🏭", group: "Operations", badgeKey: "operations" },

  // ── Finance ──
  { permKey: "can_view_finance_utpl", title: "Unze Trading", subtitle: "Cash position, forecasts, budgets", href: "/finance/unze-trading", icon: "🏢", group: "Finance", badgeKey: "utplFinance" },
  { permKey: "can_view_finance_ifpl", title: "Imperial Footwear", subtitle: "Cash position, forecasts, budgets", href: "/finance/imperial", icon: "👟", group: "Finance", badgeKey: "ifplFinance" },
  { permKey: "can_view_receivables", title: "Receivables", subtitle: "Track bills through collection stages", href: "/receivables", icon: "💰", group: "Finance", badgeKey: "receivables" },
  { permKey: "can_edit_finance", title: "Opening Balances", subtitle: "Set starting balances for companies", href: "/opening-balances", icon: "💵", group: "Finance" },

  // ── Production / Operations ──
  { permKey: "can_access_daily_entry", title: "Daily Entry", subtitle: "Log daily production and dispatch", href: "/production", icon: "📝", group: "Operations" },

  // ── Tasks & Meetings ──
  { permKey: "_tasks", title: "Tasks", subtitle: "View and manage tasks", href: "/tasks", icon: "✅", group: "Tasks & Meetings", badgeKey: "tasks" },
  { permKey: "_calendar", title: "Calendar", subtitle: "Tasks and deadlines view", href: "/calendar", icon: "📅", group: "Tasks & Meetings", badgeKey: "calendar" },
  { permKey: "can_see_all_minutes", title: "Meetings", subtitle: "Minutes, approvals, action items", href: "/meetings", icon: "🤝", group: "Tasks & Meetings", badgeKey: "meetings" },
  { permKey: "_my_minutes", title: "My Minutes", subtitle: "Meeting minutes you attended", href: "/my-minutes", icon: "📄", group: "Tasks & Meetings", badgeKey: "minutes" },
  { permKey: "can_manage_recurring_tasks", title: "Recurring Tasks", subtitle: "Manage recurring task templates", href: "/recurring-tasks", icon: "🔄", group: "Tasks & Meetings" },

  // ── Departments ──
  { permKey: "can_view_dept_ops", title: "Operations Dept", subtitle: "Unze Trading Ops department", href: "/department/Unze Trading Ops", icon: "🏭", group: "Departments" },
  { permKey: "can_view_dept_hr", title: "HR", subtitle: "Human resources dashboard", href: "/department/hr", icon: "👥", group: "Departments" },
  { permKey: "can_view_dept_tax", title: "Taxation", subtitle: "Tax notices and compliance", href: "/department/taxation", icon: "📑", group: "Departments" },
  { permKey: "can_view_dept_audit", title: "Audit", subtitle: "Internal audit tracking", href: "/department/audit", icon: "🔍", group: "Departments", badgeKey: "audit" },
  { permKey: "can_view_dept_admin", title: "Admin", subtitle: "Administration dashboard", href: "/department/admin", icon: "🏛️", group: "Departments" },
  { permKey: "can_view_dept_it", title: "IT", subtitle: "IT department dashboard", href: "/department/it", icon: "💻", group: "Departments" },

  // ── Settings ──
  { permKey: "can_view_members", title: "Members", subtitle: "Team members, roles, access", href: "/members", icon: "👤", group: "Settings", badgeKey: "members" },
  { permKey: "can_view_exceptions", title: "Exceptions", subtitle: "Exception management and alerts", href: "/exceptions", icon: "⚠️", group: "Settings" },
  { permKey: "can_view_audit_log", title: "Audit Log", subtitle: "System activity trail", href: "/audit-log", icon: "📜", group: "Settings" },
  { permKey: "_profile", title: "My Profile", subtitle: "Your account and preferences", href: "/profile", icon: "⚙️", group: "Settings" },
];
