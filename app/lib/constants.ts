export const UTPL_COMPANY_ID = "15884c2d-48a4-4d43-be90-0ef6e130790c";

// After running supabase/011_multi_company_finance.sql, replace this
// with the actual UUID from: SELECT id FROM companies WHERE short_code = 'IFPL'
export const IFPL_COMPANY_ID = "77921705-8a15-4406-847a-b234f84b5ec3";

export type CompanyConfig = {
  id: string;
  name: string;
  shortCode: string;
  slug: string;
  currency: string;
};

export const COMPANIES: CompanyConfig[] = [
  { id: UTPL_COMPANY_ID, name: "Unze Trading", shortCode: "UTPL", slug: "unze-trading", currency: "PKR" },
  { id: IFPL_COMPANY_ID, name: "Imperial Footwear", shortCode: "IFPL", slug: "imperial", currency: "PKR" },
];

export function getCompanyBySlug(slug: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.slug === slug);
}

export function getCompanyById(id: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.id === id);
}

export function getCompanyByName(name: string): CompanyConfig | undefined {
  return COMPANIES.find((c) => c.name === name);
}
