import { COLOURS } from "./SharedUI";

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
  color: string;
};

export type DepartmentConfig = {
  slug: string;
  title: string;
  departmentName: string;
  allowedRoles: string[];
  table: string;
  /** Columns the department's data table displays. Omit selectColumns to fetch all. */
  selectColumns?: string;
  columns: ColumnDef[];
  formFields: FormField[];
  kpis: KPIDef[];
  statusField: string;
  statusOptions: string[];
};

export const DEPARTMENT_CONFIGS: DepartmentConfig[] = [
  {
    slug: "audit",
    title: "Internal Audit",
    departmentName: "Audit",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "audit_plan_items",
    selectColumns: "status, target_date, completion_pct",
    statusField: "status",
    statusOptions: ["Planned", "In Progress", "Completed", "Cancelled"],
    columns: [
      { key: "audit_area", label: "Audit Area", bold: true },
      { key: "audit_type", label: "Type" },
      { key: "planned_date", label: "Planned Date" },
      { key: "target_date", label: "Target Date" },
      { key: "assigned_to", label: "Assigned To" },
      { key: "status", label: "Status" },
      { key: "audit_stage", label: "Stage" },
      { key: "completion_pct", label: "%" },
    ],
    formFields: [
      { key: "audit_area", label: "Audit Area", type: "text", required: true, placeholder: "e.g. Procurement Process" },
      { key: "audit_type", label: "Audit Type", type: "select", options: ["Financial", "Operational", "Compliance", "IT", "Other"] },
      { key: "scope", label: "Scope", type: "textarea", placeholder: "What will be audited" },
      { key: "planned_date", label: "Planned Date", type: "date" },
      { key: "target_date", label: "Target Date", type: "date", required: true },
      { key: "assigned_to", label: "Assigned To", type: "text", placeholder: "Auditor name" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "planned", label: "Planned", color: COLOURS.BLUE },
      { id: "in_progress", label: "In Progress", color: COLOURS.AMBER },
      { id: "completed", label: "Completed", color: COLOURS.GREEN },
      { id: "overdue", label: "Overdue", color: COLOURS.RED },
      { id: "avg_completion", label: "Avg Completion", color: COLOURS.PURPLE },
    ],
  },
  {
    slug: "hr",
    title: "Human Resources",
    departmentName: "HR",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "recruitment_positions",
    selectColumns: "status, date_opened",
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
      { id: "open", label: "Open Positions", color: COLOURS.AMBER },
      { id: "filled", label: "Filled", color: COLOURS.GREEN },
      { id: "long_open", label: "Open 60+ Days", color: COLOURS.RED },
      { id: "total", label: "Total", color: COLOURS.BLUE },
    ],
  },
  {
    slug: "taxation",
    title: "Tax Notices",
    departmentName: "Tax",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "legal_notices",
    selectColumns: "resolution_status, hearing_deadline, financial_exposure",
    statusField: "resolution_status",
    statusOptions: ["pending", "won", "lost", "settled"],
    columns: [
      { key: "title", label: "Notice", bold: true },
      { key: "company_name", label: "Company" },
      { key: "notice_type", label: "Type" },
      { key: "consultant_name", label: "Consultant" },
      { key: "hearing_deadline", label: "Hearing" },
      { key: "financial_exposure", label: "Exposure (PKR)" },
      { key: "resolution_status", label: "Status" },
    ],
    formFields: [
      { key: "title", label: "Notice Title", type: "text", required: true, placeholder: "e.g. Income Tax Notice FY2025" },
      { key: "notice_type", label: "Type", type: "select", options: ["income tax", "sales tax", "withholding tax", "FBR notice", "provincial tax", "customs", "other"] },
      { key: "company_name", label: "Company", type: "select", options: ["Unze Trading PVT Limited", "Imperial Footwear PVT Limited", "Haute Dolci", "Barahn PVT Limited", "K&K Jhang"] },
      { key: "received_date", label: "Received Date", type: "date" },
      { key: "consultant_name", label: "Consultant", type: "select", options: ["Rana Munir", "Rana Shehbaz", "Hashim Butt", "Others"] },
      { key: "our_action_required", label: "Our Action Required", type: "textarea" },
      { key: "consultant_action_required", label: "Consultant Action Required", type: "textarea" },
      { key: "hearing_deadline", label: "Hearing/Response Deadline", type: "date" },
      { key: "financial_exposure", label: "Financial Exposure (PKR)", type: "number", placeholder: "0" },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "pending", label: "Pending", color: COLOURS.AMBER },
      { id: "hearing_soon", label: "Hearing < 7 Days", color: COLOURS.RED },
      { id: "high_exposure", label: "Exposure > 500K", color: COLOURS.RED },
      { id: "resolved", label: "Resolved", color: COLOURS.GREEN },
    ],
  },
  {
    slug: "admin",
    title: "Administration",
    departmentName: "Admin",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "tasks",
    selectColumns: "status, due_date",
    statusField: "status",
    statusOptions: ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"],
    columns: [
      { key: "description", label: "Task", bold: true },
      { key: "project", label: "Company" },
      { key: "assigned_to", label: "Assigned To" },
      { key: "due_date", label: "Due Date" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
    ],
    formFields: [
      { key: "description", label: "Task Description", type: "text", required: true, placeholder: "e.g. Collect office rent receipt" },
      { key: "project", label: "Company", type: "select", required: true, options: ["Unze Trading PVT Limited", "Imperial Footwear PVT Limited", "Haute Dolci", "Barahn PVT Limited", "K&K Jhang"] },
      { key: "assigned_to", label: "Assigned To", type: "text", required: true, placeholder: "Person name" },
      { key: "due_date", label: "Due Date", type: "date", required: true },
      { key: "priority", label: "Priority", type: "select", options: ["Low", "Normal", "High", "Urgent"] },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "open", label: "Open Tasks", color: COLOURS.AMBER },
      { id: "overdue", label: "Overdue", color: COLOURS.RED },
      { id: "completed", label: "Completed", color: COLOURS.GREEN },
      { id: "total", label: "Total", color: COLOURS.BLUE },
    ],
  },
  {
    slug: "it",
    title: "Information Technology",
    departmentName: "IT",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "tasks",
    selectColumns: "status, due_date",
    statusField: "status",
    statusOptions: ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"],
    columns: [
      { key: "description", label: "Task", bold: true },
      { key: "assigned_to", label: "Assigned To" },
      { key: "due_date", label: "Due Date" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
    ],
    formFields: [
      { key: "description", label: "Task Description", type: "text", required: true, placeholder: "e.g. Set up new laptop for Finance" },
      { key: "assigned_to", label: "Assigned To", type: "text", required: true, placeholder: "Person name" },
      { key: "due_date", label: "Due Date", type: "date", required: true },
      { key: "priority", label: "Priority", type: "select", options: ["Low", "Normal", "High", "Urgent"] },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "open", label: "Open Tasks", color: COLOURS.AMBER },
      { id: "overdue", label: "Overdue", color: COLOURS.RED },
      { id: "completed", label: "Completed", color: COLOURS.GREEN },
      { id: "total", label: "Total", color: COLOURS.BLUE },
    ],
  },
  {
    slug: "ops",
    title: "Unze Trading Operations",
    departmentName: "Unze Trading Ops",
    allowedRoles: ["Admin", "Executive", "Manager"],
    table: "tasks",
    selectColumns: "status, due_date",
    statusField: "status",
    statusOptions: ["Not Started", "In Progress", "Waiting Reply", "Completed", "Cancelled"],
    columns: [
      { key: "description", label: "Task", bold: true },
      { key: "assigned_to", label: "Assigned To" },
      { key: "due_date", label: "Due Date" },
      { key: "priority", label: "Priority" },
      { key: "status", label: "Status" },
    ],
    formFields: [
      { key: "description", label: "Task Description", type: "text", required: true, placeholder: "e.g. Machine maintenance schedule" },
      { key: "assigned_to", label: "Assigned To", type: "text", required: true, placeholder: "Person name" },
      { key: "due_date", label: "Due Date", type: "date", required: true },
      { key: "priority", label: "Priority", type: "select", options: ["Low", "Normal", "High", "Urgent"] },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    kpis: [
      { id: "open", label: "Open Tasks", color: COLOURS.AMBER },
      { id: "overdue", label: "Overdue", color: COLOURS.RED },
      { id: "completed", label: "Completed", color: COLOURS.GREEN },
      { id: "total", label: "Total", color: COLOURS.BLUE },
    ],
  },
];

export function getDepartmentConfig(slug: string): DepartmentConfig | undefined {
  return DEPARTMENT_CONFIGS.find((d) => d.slug === slug);
}

export function getDepartmentHealthStatus(counts: Record<string, number>, config: DepartmentConfig): "GREEN" | "AMBER" | "RED" {
  const redKpis = config.kpis.filter((k) => k.color === COLOURS.RED);
  const hasRed = redKpis.some((k) => (counts[k.id] || 0) > 0);
  if (hasRed) return "RED";

  const amberKpis = config.kpis.filter((k) => k.color === COLOURS.AMBER);
  const hasAmber = amberKpis.some((k) => (counts[k.id] || 0) > 0);
  if (hasAmber) return "AMBER";

  return "GREEN";
}
