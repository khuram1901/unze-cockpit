export type FormField = {
  key: string;
  label: string;
  type: "text" | "date" | "number" | "select" | "textarea";
  options?: string[];
  required?: boolean;
  placeholder?: string;
};

export type ColumnDef = {
  key: string;
  label: string;
  bold?: boolean;
  color?: string;
};

export type KPIDef = {
  id: string;
  label: string;
  table?: string;
  countFn: (rows: Record<string, unknown>[]) => number;
  color: string;
};

export type DepartmentConfig = {
  slug: string;
  title: string;
  departmentName: string;
  allowedRoles: string[];
  table: string;
  columns: ColumnDef[];
  formFields: FormField[];
  kpis: KPIDef[];
  statusField: string;
  statusOptions: string[];
};

const today = new Date().toISOString().slice(0, 10);

function daysBetween(dateStr: string | null): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr + "T00:00:00");
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export const DEPARTMENT_CONFIGS: DepartmentConfig[] = [
  {
    slug: "audit",
    title: "Internal Audit",
    departmentName: "Audit",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "audit_plan_items",
    statusField: "status",
    statusOptions: ["Planned", "In Progress", "Completed", "Cancelled"],
    columns: [
      { key: "audit_area", label: "Audit Area", bold: true },
      { key: "audit_type", label: "Type" },
      { key: "planned_date", label: "Planned Date" },
      { key: "assigned_to", label: "Assigned To" },
      { key: "status", label: "Status" },
      { key: "findings_count", label: "Findings" },
    ],
    formFields: [
      { key: "audit_area", label: "Audit Area", type: "text", required: true, placeholder: "e.g. Procurement Process" },
      { key: "audit_type", label: "Audit Type", type: "select", options: ["Financial", "Operational", "Compliance", "IT", "Other"] },
      { key: "scope", label: "Scope", type: "textarea", placeholder: "What will be audited" },
      { key: "planned_date", label: "Planned Date", type: "date" },
      { key: "assigned_to", label: "Assigned To", type: "text", placeholder: "Auditor name" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "planned", label: "Planned", countFn: (rows) => rows.filter((r) => r.status === "Planned").length, color: "#0070f3" },
      { id: "in_progress", label: "In Progress", countFn: (rows) => rows.filter((r) => r.status === "In Progress").length, color: "#d97706" },
      { id: "completed", label: "Completed", countFn: (rows) => rows.filter((r) => r.status === "Completed").length, color: "#16a34a" },
      { id: "overdue", label: "Overdue", countFn: (rows) => rows.filter((r) => r.status !== "Completed" && r.status !== "Cancelled" && r.planned_date && (r.planned_date as string) < today).length, color: "#dc2626" },
    ],
  },
  {
    slug: "hr",
    title: "Human Resources",
    departmentName: "HR",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "recruitment_positions",
    statusField: "status",
    statusOptions: ["Open", "Interviewing", "Offered", "Filled", "Cancelled"],
    columns: [
      { key: "position_title", label: "Position", bold: true },
      { key: "department", label: "Department" },
      { key: "date_opened", label: "Date Opened" },
      { key: "status", label: "Status" },
      { key: "time_to_hire_days", label: "Days Open" },
    ],
    formFields: [
      { key: "position_title", label: "Position Title", type: "text", required: true, placeholder: "e.g. Finance Manager" },
      { key: "department", label: "Department", type: "select", options: ["Unze Trading Ops", "Finance", "HR", "Admin", "Legal", "Sales", "Audit"] },
      { key: "date_opened", label: "Date Opened", type: "date" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "open", label: "Open Positions", countFn: (rows) => rows.filter((r) => r.status === "Open" || r.status === "Interviewing").length, color: "#d97706" },
      { id: "filled", label: "Filled", countFn: (rows) => rows.filter((r) => r.status === "Filled").length, color: "#16a34a" },
      { id: "long_open", label: "Open 60+ Days", countFn: (rows) => rows.filter((r) => (r.status === "Open" || r.status === "Interviewing") && daysBetween(r.date_opened as string | null) > 60).length, color: "#dc2626" },
      { id: "total", label: "Total", countFn: (rows) => rows.length, color: "#0070f3" },
    ],
  },
  {
    slug: "legal",
    title: "Legal & Taxation",
    departmentName: "Legal",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "legal_notices",
    statusField: "resolution_status",
    statusOptions: ["pending", "won", "lost", "settled"],
    columns: [
      { key: "title", label: "Notice", bold: true },
      { key: "notice_type", label: "Type" },
      { key: "consultant_name", label: "Consultant" },
      { key: "hearing_deadline", label: "Hearing" },
      { key: "financial_exposure", label: "Exposure (PKR)" },
      { key: "resolution_status", label: "Status" },
    ],
    formFields: [
      { key: "title", label: "Notice Title", type: "text", required: true, placeholder: "e.g. Income Tax Notice FY2025" },
      { key: "notice_type", label: "Type", type: "select", options: ["tax", "legal", "regulatory", "other"] },
      { key: "company_name", label: "Company", type: "text", placeholder: "e.g. Unze Trading Pvt Ltd" },
      { key: "received_date", label: "Received Date", type: "date" },
      { key: "consultant_name", label: "Consultant", type: "text", placeholder: "Consultant name" },
      { key: "our_action_required", label: "Our Action Required", type: "textarea" },
      { key: "consultant_action_required", label: "Consultant Action Required", type: "textarea" },
      { key: "hearing_deadline", label: "Hearing/Response Deadline", type: "date" },
      { key: "financial_exposure", label: "Financial Exposure (PKR)", type: "number", placeholder: "0" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "pending", label: "Pending", countFn: (rows) => rows.filter((r) => r.resolution_status === "pending").length, color: "#d97706" },
      { id: "hearing_soon", label: "Hearing < 7 Days", countFn: (rows) => rows.filter((r) => r.resolution_status === "pending" && r.hearing_deadline && daysBetween(r.hearing_deadline as string) <= 0 && daysBetween(r.hearing_deadline as string) > -7).length, color: "#dc2626" },
      { id: "high_exposure", label: "Exposure > 500K", countFn: (rows) => rows.filter((r) => r.resolution_status === "pending" && (r.financial_exposure as number) > 500000).length, color: "#dc2626" },
      { id: "resolved", label: "Resolved", countFn: (rows) => rows.filter((r) => r.resolution_status !== "pending").length, color: "#16a34a" },
    ],
  },
  {
    slug: "admin",
    title: "Administration",
    departmentName: "Admin",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "admin_spend",
    statusField: "description",
    statusOptions: [],
    columns: [
      { key: "description", label: "Description", bold: true },
      { key: "spend_month", label: "Month" },
      { key: "amount", label: "Amount (PKR)" },
    ],
    formFields: [
      { key: "description", label: "Description", type: "text", required: true, placeholder: "e.g. Office supplies" },
      { key: "spend_month", label: "Month", type: "text", required: true, placeholder: "YYYY-MM" },
      { key: "amount", label: "Amount (PKR)", type: "number", required: true, placeholder: "0" },
    ],
    kpis: [
      { id: "this_month", label: "This Month Spend", countFn: (rows) => { const m = new Date().toISOString().slice(0, 7); return rows.filter((r) => r.spend_month === m).reduce((s, r) => s + ((r.amount as number) || 0), 0); }, color: "#0070f3" },
      { id: "total_entries", label: "Total Entries", countFn: (rows) => rows.length, color: "#64748b" },
    ],
  },
];

export function getDepartmentConfig(slug: string): DepartmentConfig | undefined {
  return DEPARTMENT_CONFIGS.find((d) => d.slug === slug);
}

export function getDepartmentHealthStatus(rows: Record<string, unknown>[], config: DepartmentConfig): "GREEN" | "AMBER" | "RED" {
  const redKpis = config.kpis.filter((k) => k.color === "#dc2626");
  const hasRed = redKpis.some((k) => k.countFn(rows) > 0);
  if (hasRed) return "RED";

  const amberKpis = config.kpis.filter((k) => k.color === "#d97706");
  const hasAmber = amberKpis.some((k) => k.countFn(rows) > 0);
  if (hasAmber) return "AMBER";

  return "GREEN";
}
