// The one Google account (Gmail/Calendar/Drive) the app's shared Google
// integration is meant to run as. Found during the 15 Jul 2026 full-app
// audit: /api/google/auth and /api/google/callback had no concept of a
// fixed identity at all — anyone could complete their own Google
// consent screen against those routes and their token would silently
// become the one getAuthenticatedClient() uses for the whole app
// (it just grabbed the most-recently-saved token, no email filter).
// Meanwhile four separate finance routes each hardcoded this same email
// as a local TARGET_EMAIL constant, assuming it was already the one in
// use. Centralised here and enforced in both the OAuth flow and the
// token lookup so the assumption those routes made is actually true.
export const GOOGLE_INTEGRATION_EMAIL = "k.saleem@unzegroup.com";

// ── Company IDs ───────────────────────────────────────────────────────────────
export const UXG_COMPANY_ID  = "c5ef2967-f06c-4302-b74f-0c096f482ffa"; // Unze Group (group-level entity)
export const UTPL_COMPANY_ID = "15884c2d-48a4-4d43-be90-0ef6e130790c";
export const IFPL_COMPANY_ID = "77921705-8a15-4406-847a-b234f84b5ec3";
export const BRNH_COMPANY_ID = "6401ba75-f297-4617-84c1-305bcaf35a50";
export const HD_COMPANY_ID   = "16a92b7f-b3fa-4271-819b-c6befb534f12";
export const ALM_COMPANY_ID  = "99bb9f67-4b19-48cb-b283-de1a8cabbd88";
export const DIR_COMPANY_ID  = "e867582b-2093-4d10-8eaf-de54a168ee55";
export const SMI_COMPANY_ID  = "7f3b9e2a-4c1d-4f8e-a234-b5c6d7e8f901"; // S&M Investments
export const UZL_COMPANY_ID  = "8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012"; // Unze London (UK)
export const KKJ_COMPANY_ID  = "4e515021-b63f-478b-a69e-90be3d8367c7"; // K&K Jhang (tax/accounts only)

export type CompanyConfig = {
  id: string;
  name: string;
  shortCode: string;
  slug: string;
  currency: string;
};

// Canonical company list — single source of truth for the entire app.
// Unze Group is the umbrella entity for group-level departments (HR, Admin, IT).
// K&K Jhang is a tax/accounts-only entity — not operational.
export const COMPANIES: CompanyConfig[] = [
  { id: UXG_COMPANY_ID,  name: "Unze Group",                    shortCode: "UXG",  slug: "unze-group",      currency: "PKR" },
  { id: UTPL_COMPANY_ID, name: "Unze Trading PVT Limited",      shortCode: "UTPL", slug: "unze-trading",    currency: "PKR" },
  { id: IFPL_COMPANY_ID, name: "Imperial Footwear PVT Limited",  shortCode: "IFPL", slug: "imperial",        currency: "PKR" },
  { id: BRNH_COMPANY_ID, name: "Baranh",                         shortCode: "BRNH", slug: "baranh",          currency: "PKR" },
  { id: HD_COMPANY_ID,   name: "Haute Dolci",                    shortCode: "HD",   slug: "haute-dolci",     currency: "PKR" },
  { id: ALM_COMPANY_ID,  name: "Almahar",                        shortCode: "ALM",  slug: "almahar",         currency: "PKR" },
  { id: DIR_COMPANY_ID,  name: "Directors",                      shortCode: "DIR",  slug: "directors",       currency: "PKR" },
  { id: SMI_COMPANY_ID,  name: "S&M Investments",                shortCode: "SMI",  slug: "sm-investments",  currency: "PKR" },
  { id: UZL_COMPANY_ID,  name: "Unze London",                    shortCode: "UZL",  slug: "unze-london",     currency: "GBP" },
  { id: KKJ_COMPANY_ID,  name: "K&K Jhang",                      shortCode: "KKJ",  slug: "kk-jhang",        currency: "PKR" },
];

// Companies with a cash/PDC finance pipeline wired up (Executive Dashboard
// cash feed loop and per-company widget picker). Single source of truth —
// add a company's pipeline once and both places pick it up automatically.
export const FINANCE_COMPANIES: CompanyConfig[] = COMPANIES.filter(
  (c) => c.shortCode === "UTPL" || c.shortCode === "IFPL"
);

// Companies with department budget tracking.
// User confirmed 28/07/2026: UTPL, IFPL, Baranh, Haute Dolci, Unze London
// plus Unze Group (group-level HR/Admin/IT budget).
export const BUDGET_COMPANIES: CompanyConfig[] = COMPANIES.filter(
  (c) => ["UXG", "UTPL", "IFPL", "BRNH", "HD", "UZL"].includes(c.shortCode)
);

// Companies that employ staff in Pakistan (shown in HR/payroll/EOBI screens).
// Excludes Unze London (UK payroll), K&K Jhang (no employees), S&M
// Investments and Directors (no direct staff).
export const PKR_HR_COMPANIES: CompanyConfig[] = COMPANIES.filter(
  (c) => ["UTPL", "IFPL", "BRNH", "HD", "ALM"].includes(c.shortCode)
);

// Company display names for member assignment — every entity a staff member
// can belong to, including the group umbrella.
export const MEMBER_COMPANY_NAMES: string[] = COMPANIES
  .filter((c) => c.shortCode !== "KKJ") // K&K Jhang has no staff in the system
  .map((c) => c.name);

// Company names used on taxation / accounts-and-returns pages.
// K&K Jhang included — only entity that is tax/accounts only.
export const TAX_COMPANY_NAMES: string[] = [
  "Unze Trading PVT Limited",
  "Imperial Footwear PVT Limited",
  "Haute Dolci",
  "Baranh",
  "K&K Jhang",
  "Directors",
];

export function getCompanyBySlug(slug: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.slug === slug);
}

export function getCompanyById(id: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.id === id);
}

export function getCompanyByName(name: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.name === name || c.name.startsWith(name));
}

// ── Department Budget lookup tables ───────────────────────────────────────────
// Single source of truth for finance/page.tsx and FinanceManager.tsx.
//
// Rule (confirmed 28/07/2026): HR, Admin, and IT are GROUP-LEVEL departments
// and belong exclusively to Unze Group (UXG). Individual companies must not
// carry HR/Admin/IT budget lines — those costs sit at the group level.
//
// Departments per company:
//   Unze Group   — HR, Admin, IT  (group overhead)
//   UTPL         — Finance, Tax, Legal, Sales, Audit, Unze Trading Ops
//   IFPL         — Finance, Tax, Legal, Sales, Audit
//   Baranh       — Finance, Operations, Marketing
//   Haute Dolci  — Finance, Operations, Marketing
//   Unze London  — Finance, Retail, Marketing  (GBP; no EOBI/payroll)
export const COMPANY_DEPARTMENTS: Record<string, string[]> = {
  [UXG_COMPANY_ID]:  ["HR", "Admin", "IT"],
  [UTPL_COMPANY_ID]: ["Finance", "Tax", "Legal", "Sales", "Audit", "Unze Trading Ops"],
  [IFPL_COMPANY_ID]: ["Finance", "Tax", "Legal", "Sales", "Audit"],
  [BRNH_COMPANY_ID]: ["Finance", "Operations", "Marketing"],
  [HD_COMPANY_ID]:   ["Finance", "Operations", "Marketing"],
  [UZL_COMPANY_ID]:  ["Finance", "Retail", "Marketing"],
};

export const COMPANY_CATEGORIES: Record<string, string[]> = {
  [UXG_COMPANY_ID]:  ["Salaries", "Rent/Utilities", "Admin", "Welfare", "IT", "Subscriptions"],
  [UTPL_COMPANY_ID]: ["Salaries", "Rent/Utilities", "Admin", "Welfare", "Freight", "Travel"],
  [IFPL_COMPANY_ID]: ["Salaries", "Rent/Utilities", "Admin", "Marketing", "Freight", "Travel"],
  [BRNH_COMPANY_ID]: ["Salaries", "Rent/Utilities", "Food & Beverage", "Marketing", "Franchise"],
  [HD_COMPANY_ID]:   ["Salaries", "Rent/Utilities", "Food & Beverage", "Marketing"],
  [UZL_COMPANY_ID]:  ["Salaries", "Rent/Utilities", "Admin", "Marketing", "Freight", "Travel"],
};

export function deptsForCompany(companyId: string): string[] {
  return COMPANY_DEPARTMENTS[companyId] ?? ["Finance", "Tax", "Legal", "Sales", "Audit"];
}

export function catsForCompany(companyId: string): string[] {
  return COMPANY_CATEGORIES[companyId] ?? ["Salaries", "Rent/Utilities", "Admin", "Freight", "Travel"];
}
