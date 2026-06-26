# Access Control — Roles, Rights & Accessibility

> Single source of truth for **who can see and do what**. Two layers enforce this:
> 1. **UI** (nav links, page guards) — what a user can *see/click*
> 2. **RLS** (Supabase Row-Level Security) — what data the API will *return/accept*, even via direct queries
>
> The matrix below reflects the **current code + migrations**. Use the "DEFINE" section at the bottom to set the people, then we update code/RLS to match in one pass.

---

## 1. Roles (4 system roles)

| Role | Meaning | Lands on after login |
|------|---------|----------------------|
| **Admin** | Full system control | `/home` |
| **Executive** | Full company view (incl. finance) | `/home` |
| **Manager** | Head of a department (HOD) — own department data | `/my-dashboard` |
| **Member** | Individual contributor — own tasks only | `/my-dashboard` |

**Special accounts (recognised by EMAIL, not role):**

| Email | Treated as | Lands on | Notes |
|-------|-----------|----------|-------|
| `k.saleem@unzegroup.com` | **CEO** | `/home` (CEO layout) | Shown as "CEO" everywhere; protected (cannot be deleted) |
| `khuram1901@gmail.com` | **Main Admin** | `/home` | Protected; hardcoded admin |
| `pa.ceo@unze.co.uk` | **PA / Assistant** | `/home` (PA layout) | Blocked from finance/receivables/executive |

**Departments in the system:** Unze Trading Ops · Finance · HR · Admin · Legal · Sales · Audit

---

## 2. Page access matrix

Legend: ✅ full · 👁️ view only · 🔸 own-department only · ❌ none

| Page | Admin | Executive | CEO | Manager | Member | PA |
|------|:-----:|:---------:|:---:|:-------:|:------:|:--:|
| `/home` (command centre) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ (PA layout) |
| `/my-dashboard` | — | — | — | ✅ | ✅ | — |
| `/executive` (exec dashboard) | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/dashboard` (operations) | ✅ | ✅ | ✅ | 👁️ | 👁️ | ❌ |
| `/production` (daily entry) | ✅ | ✅ | ✅ | ✅ Ops only | ✅ Ops only | ❌ |
| `/finance`, `/finance/[company]` | ✅ | ✅ | ✅ | ✅ Finance mgr only | ❌ | ❌ |
| `/receivables` | ✅ | ✅ | ✅ | 👁️ Ops/Finance mgr | ❌ | ❌ |
| `/tasks` | ✅ all | ✅ all | ✅ all | own assigned | own assigned | ✅ all |
| `/calendar` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/meetings` | ✅ | ✅ | ✅ | 👁️ | ❌ | ✅ |
| `/my-minutes` | ✅ all | ✅ all | ✅ all | own meetings | ❌ | ✅ |
| `/members` | ✅ | ✅ | ✅ | 👁️ | 👁️ | 👁️ |
| `/department/[audit\|hr\|taxation\|admin]` | ✅ | ✅ | ✅ | 🔸 own dept | ❌ | ❌ |
| `/audit-log` | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| `/recurring-tasks` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/monthly-operations-targets` | ✅ | ✅ | ✅ | 👁️ | ❌ | ❌ |
| `/opening-balances` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/exceptions` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `/profile` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 3. Data access (RLS) — what the database enforces

| Table group | Who can READ / WRITE |
|-------------|----------------------|
| **Finance** (`daily_cash_position`, `monthly_cash_plan`, `cash_opening_balance`, `monthly_budgets`, `quarterly_forecasts`) | Admin · Executive · CEO · Finance Manager |
| **Receivables** (`receivables`, `receivable_stages`) | Admin · Executive · CEO · Finance Manager · Ops Manager *(after migration 026)* |
| **Tasks** | Admin/Exec/CEO: all · others: only tasks assigned to/by them |
| **Members** | Everyone reads · only Admin/Exec/CEO writes |
| **Production/Dispatch/Breakage/Scrap** | Everyone authenticated reads · anyone writes (daily entry) |
| **Department tables** (audit/HR/legal/admin) | Admin/Exec/CEO · Manager of that department only |
| **Google OAuth tokens** | Admin/Exec/CEO only (sensitive) |
| **Audit log** | Admin reads · anyone writes |

---

## 4. Special per-email overrides on Receivables

These are hardcoded in `app/receivables/page.tsx`:

| Email | Right |
|-------|-------|
| `asif.shakoor@unze.co.uk` | **Edit** receivables |
| `usman.arshad@unze.co.uk` | **Edit** receivables |
| `sania.saleem@unze.co.uk` | **View** receivables |
| `nadeem.khan@unze.co.uk` | **View** receivables |

---

## 5. CURRENT TEAM (live `members` data, 2026-06) — with flags

Legend for **Flag**: 🔴 = mismatch / over-permission to fix · ⚠️ = needs decision · ✅ = looks correct

| Name | Email | Role | Department | Company | Effective access today | Flag |
|------|-------|------|-----------|---------|------------------------|------|
| Khuram Saleem | khuram1901@gmail.com | Admin | — | — | Everything (main admin) | ✅ |
| Khuram Saleem (CEO) | k.saleem@unzegroup.com | Admin | — | UTPL | Everything + "CEO" label/layout | ✅ |
| **Sundas Hussain (PA)** | pa.ceo@unze.co.uk | **Executive** | — | — | **ALL finance + receivables + exec data via API** | 🔴 should be blocked from those |
| Muhammad Akhlaq | akhlaq@unze.co.uk | Manager | Admin | — | Admin dept dashboard | ✅ |
| Shahid Masaud | shahid@unze.co.uk | Manager | Audit | — | Audit dept dashboard | ✅ |
| Muhammad Shakeel | shakeel@unze.co.uk | Manager | Finance | — | All finance (both companies) R/W | ⚠️ company scope? |
| Sania Saleem | sania.saleem@unze.co.uk | Manager | Finance | UTPL | All finance R/W (+ in receivables VIEW_EMAILS — contradicts) | 🔴 conflicting override |
| Shahida Naseem | shahida.naseem@unze.co.uk | Manager | Finance | IFPL | All finance (both companies) R/W | ⚠️ company scope? |
| Zuhair Khalid | zuhair.syed@unze.co.uk | Manager | HR | — | HR dept dashboard | ✅ |
| Muhammad Nadeem | nadeem@unze.co.uk | Manager | **IT** | — | **No dept page/RLS for IT exists** | 🔴 orphan department |
| Awais Zaman | taxation@unze.co.uk | Manager | **Tax** | — | RLS works ('Tax'); UI config says 'Legal' | 🔴 UI/data name mismatch |
| Asif Shakoor | asif.shakoor@unze.co.uk | Manager | Unze Trading Ops | UTPL | Ops + receivables EDIT | ✅ |
| Nadeem Khan | nadeem.khan@unze.co.uk | Manager | Unze Trading Ops | UTPL | Ops + receivables (in VIEW_EMAILS, but Ops mgr = full) | ⚠️ override redundant |
| Usman Arshad | usman.arshad@unze.co.uk | Manager | Unze Trading Ops | UTPL | Ops + receivables EDIT | ✅ |
| Yahya Saleem | yahya@unze.co.uk | Manager | Unze Trading Ops | UTPL | Ops + receivables (Ops mgr = full) | ✅ |

### 🔴 Issues to fix
1. **PA over-permissioned** — Sundas (`pa.ceo`) is `Executive`, so RLS grants her all finance/receivables/exec data. The UI guards added earlier don't stop API access. **Fix:** change her role (to `Member`/`Manager`) OR add an email-based deny in RLS.
2. **`Tax` vs `Legal` name mismatch** — DB department is `Tax`, RLS uses `Tax`, but `department-config.ts` taxation page uses `departmentName: "Legal"`. Pick one canonical name.
3. **IT department orphaned** — Muhammad Nadeem is `IT`, which has no dashboard, config, or RLS. Decide: add an IT department, or remap him.
4. **Receivables email overrides redundant/conflicting** — `EDIT_EMAILS`/`VIEW_EMAILS` overlap with the new Ops/Finance manager RLS (migration 026). Sania is both a Finance Manager (full R/W) and in `VIEW_EMAILS`. **Recommend:** drop the hardcoded email lists, derive edit/view from role+department.

### ⚠️ Decisions
5. **Finance company scoping** — Sania (UTPL) and Shahida (IFPL) are tagged to companies, but `is_finance_manager()` grants both access to *both* companies' finance. Do you want finance RLS scoped per-company (Sania → UTPL only, Shahida → IFPL only, Shakeel → both)?
6. **CEO role** — `k.saleem` is `Admin` (not `Executive`). Fine functionally, but confirm intended (Admin can edit other admins, see audit log, etc.).

---

## 6. TARGET WORKSHEET — edit any cell, hand it back in one go

**Your decisions already applied as defaults:** Tax = canonical name · IT = new department · Finance = scoped per company.

**Access columns** — put one of: `Full` · `View` · `Edit` · `None` (or leave the suggested default).
**Finance scope** — `UTPL` · `IFPL` · `Both` · `None`.

| # | Name | Email | Role | Department | Receivables | Finance scope | Dept dashboard | Notes / change |
|---|------|-------|------|-----------|-------------|---------------|----------------|----------------|
| 1 | Khuram Saleem | khuram1901@gmail.com | Admin | — | Full | Both | All | Main admin (protected) |
| 2 | Khuram Saleem (CEO) | k.saleem@unzegroup.com | Admin | — | Full | Both | All | "CEO" label + layout (protected) |
| 3 | Sundas Hussain (PA) | pa.ceo@unze.co.uk | **❓ SET ROLE** | — | None | None | None | Currently Executive = sees everything. Set her role. |
| 4 | Muhammad Akhlaq | akhlaq@unze.co.uk | Manager | Admin | None | None | Admin only | |
| 5 | Shahid Masaud | shahid@unze.co.uk | Manager | Audit | None | None | Audit only | |
| 6 | Muhammad Shakeel | shakeel@unze.co.uk | Manager | Finance | None | Both | — | Group finance (no company tag) |
| 7 | Sania Saleem | sania.saleem@unze.co.uk | Manager | Finance | View | UTPL | — | Currently also in receivables VIEW list |
| 8 | Shahida Naseem | shahida.naseem@unze.co.uk | Manager | Finance | None | IFPL | — | |
| 9 | Zuhair Khalid | zuhair.syed@unze.co.uk | Manager | HR | None | None | HR only | |
| 10 | Muhammad Nadeem | nadeem@unze.co.uk | Manager | IT | None | None | IT only (new) | |
| 11 | Awais Zaman | taxation@unze.co.uk | Manager | Tax | None | None | Tax only | |
| 12 | Asif Shakoor | asif.shakoor@unze.co.uk | Manager | Unze Trading Ops | Edit | None | — | |
| 13 | Nadeem Khan | nadeem.khan@unze.co.uk | Manager | Unze Trading Ops | View | None | — | Currently in receivables VIEW list |
| 14 | Usman Arshad | usman.arshad@unze.co.uk | Manager | Unze Trading Ops | Edit | None | — | |
| 15 | Yahya Saleem | yahya@unze.co.uk | Manager | Unze Trading Ops | View | None | — | Ops mgr — set Edit or View? |

### Still need from you (only these)
- **Row 3** — what role for the PA? (`Member` = fully locked out of finance/receivables; `Manager` = manager nav, still no finance/receivables).
- **Receivables Edit vs View** per Ops/Finance manager (rows 7, 12–15) — confirm or change.
- Anything else you want to flip — just edit the cell.

### Verified (2026-06): per-company finance scoping is feasible
All finance tables carry `company_id uuid → companies(id)`: `daily_cash_position`,
`monthly_cash_plan`, `cash_opening_balance`, `monthly_budgets`, `quarterly_forecasts`,
`bank_position_snapshots`, `department_budgets`. The RLS helper will map
`members.company` (full name) → `companies.name`; Admin/Exec/CEO and finance
managers with no `company` (e.g. Shakeel) get **both** companies.

Once you hand this back, I will, in one pass:
1. Generate the SQL to set roles/departments in `members`.
2. Rename Tax canonical + fix the UI config (`Legal` → `Tax`).
3. Add the IT department (dashboard + config + RLS).
4. Replace the hardcoded receivables email lists with role/department logic.
5. Add per-company finance RLS scoping.
6. Re-confirm CEO/Admin are safeguarded.
