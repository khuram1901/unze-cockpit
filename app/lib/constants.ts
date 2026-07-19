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

export const UTPL_COMPANY_ID = "15884c2d-48a4-4d43-be90-0ef6e130790c";
export const IFPL_COMPANY_ID = "77921705-8a15-4406-847a-b234f84b5ec3";
export const BRNH_COMPANY_ID = "6401ba75-f297-4617-84c1-305bcaf35a50";
export const HD_COMPANY_ID   = "16a92b7f-b3fa-4271-819b-c6befb534f12";
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

export const COMPANIES: CompanyConfig[] = [
  { id: UTPL_COMPANY_ID, name: "Unze Trading PVT Limited",      shortCode: "UTPL", slug: "unze-trading",    currency: "PKR" },
  { id: IFPL_COMPANY_ID, name: "Imperial Footwear PVT Limited",  shortCode: "IFPL", slug: "imperial",        currency: "PKR" },
  { id: BRNH_COMPANY_ID, name: "Baranh",                         shortCode: "BRNH", slug: "baranh",          currency: "PKR" },
  { id: HD_COMPANY_ID,   name: "Haute Dolci",                    shortCode: "HD",   slug: "haute-dolci",     currency: "PKR" },
  { id: ALM_COMPANY_ID,  name: "Almahar",                        shortCode: "ALM",  slug: "almahar",         currency: "PKR" },
  { id: DIR_COMPANY_ID,  name: "Directors",                      shortCode: "DIR",  slug: "directors",       currency: "PKR" },
  { id: SMI_COMPANY_ID,  name: "S&M Investments",                shortCode: "SMI",  slug: "sm-investments",  currency: "PKR" },
  { id: UZL_COMPANY_ID,  name: "Unze London",                    shortCode: "UZL",  slug: "unze-london",     currency: "GBP" },
];

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
  return COMPANIES.find((c) => c.name === name || c.name.startsWith(name));
}
