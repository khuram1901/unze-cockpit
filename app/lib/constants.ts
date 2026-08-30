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

// Automatic creation of CASH SHEETS from emailed / Drive-dropped PDFs.
// Switched OFF on 14/08/2026: /api/finance/check-inbox and check-drive both
// decide the company with `company === "imperial" ? IFPL : UTPL`, so every
// Baranh, Haute Dolci and K&K Jhang sheet was filed as Unze Trading (five days
// had to be removed by hand). Cash sheets are uploaded on the Banking page now.
//
// This flag ONLY stops the cash-sheet / daily-cash-position writes. Both crons
// still run on their normal schedule and everything else they do is unchanged —
// document archiving, bank-position snapshots and reconciliation, and moving
// Drive files to the processed folder all carry on exactly as before.
export const FINANCE_AUTO_CASH_SHEET_IMPORT = false;

export const UTPL_COMPANY_ID = "15884c2d-48a4-4d43-be90-0ef6e130790c";
export const IFPL_COMPANY_ID = "77921705-8a15-4406-847a-b234f84b5ec3";
export const BRNH_COMPANY_ID = "6401ba75-f297-4617-84c1-305bcaf35a50";
export const HD_COMPANY_ID   = "16a92b7f-b3fa-4271-819b-c6befb534f12";
export const KKJ_COMPANY_ID  = "4e515021-b63f-478b-a69e-90be3d8367c7"; // K&K Jhang
export const ALM_COMPANY_ID  = "99bb9f67-4b19-48cb-b283-de1a8cabbd88";
export const DIR_COMPANY_ID  = "e867582b-2093-4d10-8eaf-de54a168ee55";
export const SMI_COMPANY_ID  = "7f3b9e2a-4c1d-4f8e-a234-b5c6d7e8f901"; // S&M Investments
export const UZL_COMPANY_ID  = "8a4c0f3b-5d2e-4a9f-b345-c6d7e8f90012"; // Unze London

export type CompanyConfig = {
  id: string;
  name: string;
  shortCode: string;
  slug: string;
  currency: string;
};

// Names below are the CANONICAL display names, kept in sync with the
// companies table in Supabase (renamed 30/08/2026 on Khuram's instruction:
// Unze Trading, Imperial Footwear, HD, S&M Investment). If a company is
// renamed in the database, rename it here too — and vice versa.
export const COMPANIES: CompanyConfig[] = [
  { id: UTPL_COMPANY_ID, name: "Unze Trading",      shortCode: "UTPL", slug: "unze-trading",    currency: "PKR" },
  { id: IFPL_COMPANY_ID, name: "Imperial Footwear", shortCode: "IFPL", slug: "imperial",        currency: "PKR" },
  { id: BRNH_COMPANY_ID, name: "Baranh",            shortCode: "BRNH", slug: "baranh",          currency: "PKR" },
  { id: HD_COMPANY_ID,   name: "HD",                shortCode: "HD",   slug: "haute-dolci",     currency: "PKR" },
  { id: KKJ_COMPANY_ID,  name: "K&K Jhang",         shortCode: "KKJ",  slug: "kk-jhang",        currency: "PKR" },
  { id: ALM_COMPANY_ID,  name: "Almahar",           shortCode: "ALM",  slug: "almahar",         currency: "PKR" },
  { id: DIR_COMPANY_ID,  name: "Directors",         shortCode: "DIR",  slug: "directors",       currency: "PKR" },
  { id: SMI_COMPANY_ID,  name: "S&M Investment",    shortCode: "SMI",  slug: "sm-investments",  currency: "PKR" },
  { id: UZL_COMPANY_ID,  name: "Unze London",       shortCode: "UZL",  slug: "unze-london",     currency: "GBP" },
];

// Legacy spellings that still exist in old data (members.company,
// legal_notices.company_name, historic uploads). getCompanyByName()
// resolves these to the canonical company so old records keep working.
export const LEGACY_COMPANY_ALIASES: Record<string, string> = {
  "unze trading pvt limited":      UTPL_COMPANY_ID,
  "unze trading pvt ltd":          UTPL_COMPANY_ID,
  "imperial footwear pvt limited": IFPL_COMPANY_ID,
  "imperial footwear pvt ltd":     IFPL_COMPANY_ID,
  "haute dolci":                   HD_COMPANY_ID,
  "barahn pvt limited":            BRNH_COMPANY_ID,
  "brnh":                          BRNH_COMPANY_ID,
  "s&m investments":               SMI_COMPANY_ID,
};

export function companyNameByCode(shortCode: string): string {
  return COMPANIES.find((c) => c.shortCode === shortCode)?.name ?? shortCode;
}

// Companies with a finance data pipeline (cash positions, PDC, budgets,
// receivables) wired up. Single source of truth for both the Executive
// Dashboard's finance fetch loop (app/home/page.tsx) and the per-company
// widget picker (app/lib/widgetRegistry.ts) so they can never drift apart —
// add a company's finance pipeline once, both the dashboard and the matrix
// toggle list pick it up automatically.
export const FINANCE_COMPANIES: CompanyConfig[] = COMPANIES.filter(
  (c) => c.shortCode === "UTPL" || c.shortCode === "IFPL"
);

export function getCompanyBySlug(slug: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.slug === slug);
}

export function getCompanyById(id: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.id === id);
}

export function getCompanyByName(name: string): CompanyConfig | undefined {
  const exact = COMPANIES.find((c) => c.name === name || c.name.startsWith(name));
  if (exact) return exact;
  // Fall back to legacy spellings still present in old data
  const legacyId = LEGACY_COMPANY_ALIASES[name.trim().toLowerCase()];
  return legacyId ? COMPANIES.find((c) => c.id === legacyId) : undefined;
}

// Company names for the Taxation notices dashboard — single source of truth so
// TaxationDashboard.tsx and any future consumer stay in sync with the IDs above.
export const TAX_COMPANY_NAMES: string[] = ["UTPL", "IFPL", "HD", "BRNH", "KKJ", "DIR"]
  .map(companyNameByCode);

// ── Department Budget lookup tables ───────────────────────────────────────────
// Single source of truth for both finance/page.tsx and FinanceManager.tsx.
// Previously defined separately in each file with different variable names,
// which meant a department added to one wouldn't appear in the other.
export const COMPANY_DEPARTMENTS: Record<string, string[]> = {
  [UTPL_COMPANY_ID]: ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit", "Unze Trading Ops"],
  [IFPL_COMPANY_ID]: ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"],
};

export const COMPANY_CATEGORIES: Record<string, string[]> = {
  [UTPL_COMPANY_ID]: ["Salaries", "Rent/Utilities", "Admin", "Welfare", "Freight", "Travel"],
  [IFPL_COMPANY_ID]: ["Salaries", "Rent/Utilities", "Admin", "Marketing", "Freight", "Travel"],
};

export function deptsForCompany(companyId: string): string[] {
  return COMPANY_DEPARTMENTS[companyId] ?? ["Finance", "HR", "Admin", "IT", "Tax", "Legal", "Sales", "Audit"];
}

export function catsForCompany(companyId: string): string[] {
  return COMPANY_CATEGORIES[companyId] ?? ["Salaries", "Rent/Utilities", "Admin", "Freight", "Travel"];
}

// BUDGET_COMPANIES — companies with a department-budget pipeline wired up.
// Currently the same set as FINANCE_COMPANIES (UTPL + IFPL). Kept as a
// separate export so finance/page.tsx can import it by its own semantic name.
export const BUDGET_COMPANIES: CompanyConfig[] = COMPANIES.filter(
  (c) => c.shortCode === "UTPL" || c.shortCode === "IFPL"
);

// MEMBER_COMPANY_NAMES — full list of company names available in the Members
// module. Covers all companies so any new company added to COMPANIES is
// automatically available in member records. "Unze Group" is appended for
// members who span both entities (shared/group-level staff).
export const MEMBER_COMPANY_NAMES: string[] = [...COMPANIES.map((c) => c.name), "Unze Group"];

// PKR_HR_COMPANIES — companies on the PKR payroll tracked by the HR module
// (Payroll, Onboarding, Offboarding). Excludes Unze London which runs on GBP.
export const PKR_HR_COMPANIES: CompanyConfig[] = COMPANIES.filter(
  (c) => c.currency === "PKR"
);
