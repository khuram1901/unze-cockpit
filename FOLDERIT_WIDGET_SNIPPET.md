# Manual step: add the Folderit card to the Executive Dashboard

I didn't auto-edit `app/home/page.tsx` — it's a 3000+ line file and I'd rather
you paste this in deliberately than risk a silent break from a blind
find-replace. Three small additions, mirroring exactly how the Aviva pension
card works.

## 1. State (near the `pensionSummary` useState, ~line 468)

```tsx
const [folderitSummary, setFolderitSummary] = useState<{
  pendingApproval: number;
  companyInbox: number;
  hrInbox: number;
} | null>(null);
```

## 2. Fetch it inside the existing dashboard data-load effect (same place pensionSummary is computed, ~line 1011-1033) — additive/non-fatal, same as pension:

```tsx
try {
  const folderitRes = await authFetch("/api/folderit/summary");
  if (folderitRes.ok) {
    const f = await folderitRes.json();
    setFolderitSummary({
      pendingApproval: f.pending_approval_count ?? 0,
      companyInbox: f.company_inbox_count ?? 0,
      hrInbox: f.hr_inbox_count ?? 0,
    });
  }
} catch { /* non-fatal — Folderit card is additive, same as pension */ }
```

(`authFetch` is already imported at the top of `home/page.tsx` for other calls — if not, `import { authFetch } from "../lib/supabase";`.)

## 3. Render it as a card, right next to the "UK PENSION — AVIVA" block (~line 2967)

```tsx
{folderitSummary && (
  <div style={{ ...cardStyle, boxShadow: SHADOWS.SM, padding: "16px 20px", cursor: "pointer" }}
       onClick={() => router.push("/folderit")}>
    <div style={{ fontSize: "13px", fontWeight: 600, color: SLATE, textTransform: "uppercase" }}>
      Folderit
    </div>
    <div style={{ display: "flex", gap: "20px", marginTop: "8px" }}>
      <div>
        <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.AMBER }}>
          {folderitSummary.pendingApproval}
        </div>
        <div style={{ fontSize: "12px", color: SLATE }}>Pending my approval</div>
      </div>
      <div>
        <div style={{ fontSize: "22px", fontWeight: 700, color: COLOURS.BLUE }}>
          {folderitSummary.companyInbox}
        </div>
        <div style={{ fontSize: "12px", color: SLATE }}>Company inbox unfiled</div>
      </div>
    </div>
  </div>
)}
```

Adjust `router.push` to whatever navigation pattern the surrounding cards
already use (some use `<Link>`, some use a click handler — match neighbours).
