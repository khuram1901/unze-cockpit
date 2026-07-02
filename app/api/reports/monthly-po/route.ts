import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

function fmtNum(n: number) { return n.toLocaleString(); }
function fmtPct(n: number) { return `${Math.round(n)}%`; }

function pctColor(pct: number) {
  return pct >= 90 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";
}

function progressBar(pct: number, width = 200): string {
  const clamped = Math.min(100, Math.max(0, pct));
  const filled = Math.round((clamped / 100) * width);
  const color = pctColor(pct);
  return `<div style="display:inline-block;vertical-align:middle;background:#e2e8f0;border-radius:3px;width:${width}px;height:10px;overflow:hidden">` +
    `<div style="background:${color};width:${filled}px;height:10px;border-radius:3px"></div></div>` +
    `<span style="margin-left:8px;font-weight:700;color:${color};font-size:13px">${fmtPct(pct)}</span>`;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();

    // Determine report month: previous calendar month
    const now = new Date();
    const reportYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const reportMonth = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-based
    const reportMonthStr = `${reportYear}-${String(reportMonth).padStart(2, "0")}`;
    const monthStart = `${reportMonthStr}-01`;
    const lastDay = new Date(reportYear, reportMonth, 0).getDate();
    const monthEnd = `${reportMonthStr}-${String(lastDay).padStart(2, "0")}`;
    const monthLabel = new Date(reportYear, reportMonth - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

    // 1. Fetch all active plants
    const { data: plants } = await supabase
      .from("plants")
      .select("id, name")
      .eq("active", true)
      .order("name");

    if (!plants?.length) {
      return Response.json({ ok: true, message: "No active plants found" });
    }

    // 2. Fetch all POs with production allocations and authority letters + dispatch records
    const { data: pos } = await supabase
      .from("purchase_orders")
      .select("id, plant_id, plant_name, customer_name, po_number, po_label, status, is_system_unallocated, ordered_31, ordered_36, ordered_45, ordered_meter, opening_produced_31, opening_produced_36, opening_produced_45, opening_produced_meter, start_date")
      .order("customer_name");

    // 3. Production allocations for this month (to calculate month contribution)
    const { data: monthAllocs } = await supabase
      .from("production_allocations")
      .select("po_id, qty_31, qty_36, qty_45, qty_meter, production_entries!inner(entry_date)")
      .filter("production_entries.entry_date", "gte", monthStart)
      .filter("production_entries.entry_date", "lte", monthEnd);

    // All-time production allocations (for cumulative totals)
    const { data: allAllocs } = await supabase
      .from("production_allocations")
      .select("po_id, qty_31, qty_36, qty_45, qty_meter");

    // 4. All authority letters with dispatch records
    const { data: letters } = await supabase
      .from("authority_letters")
      .select("id, po_id, contractor_id, letter_number, qty_31, qty_36, qty_45, qty_meter, opening_dispatched_31, opening_dispatched_36, opening_dispatched_45, opening_dispatched_meter, contractors(name), dispatch_records(dispatch_date, qty_31, qty_36, qty_45, qty_meter)");

    // Helpers to sum qty
    function sumQty(rows: { qty_31?: number; qty_36?: number; qty_45?: number; qty_meter?: number }[]) {
      return rows.reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);
    }

    // Build maps
    const monthProdByPO: Record<string, number> = {};
    for (const r of monthAllocs || []) {
      monthProdByPO[r.po_id] = (monthProdByPO[r.po_id] || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }

    const allProdByPO: Record<string, number> = {};
    for (const r of allAllocs || []) {
      allProdByPO[r.po_id] = (allProdByPO[r.po_id] || 0) + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0);
    }

    // Dispatch records for this month (filter by dispatch_date)
    const monthDispByLetter: Record<string, number> = {};
    const allDispByLetter: Record<string, number> = {};
    for (const l of letters || []) {
      const records = (l.dispatch_records || []) as { dispatch_date: string; qty_31: number; qty_36: number; qty_45: number; qty_meter: number }[];
      const monthRecs = records.filter((r) => r.dispatch_date >= monthStart && r.dispatch_date <= monthEnd);
      monthDispByLetter[l.id] = sumQty(monthRecs);
      allDispByLetter[l.id] = (l.opening_dispatched_31 || 0) + (l.opening_dispatched_36 || 0) + (l.opening_dispatched_45 || 0) + (l.opening_dispatched_meter || 0) + sumQty(records);
    }

    // Group letters by PO
    const lettersByPO: Record<string, typeof letters> = {};
    for (const l of letters || []) {
      if (!lettersByPO[l.po_id]) lettersByPO[l.po_id] = [];
      lettersByPO[l.po_id]!.push(l);
    }

    // 5. Build per-plant report sections
    type POReport = {
      po_id: string; customer_name: string; po_number: string; po_label: string;
      status: string; is_system_unallocated: boolean;
      ordered: number; produced_total: number; dispatched_total: number; in_stock: number;
      fulfillment_pct: number; production_pct: number;
      month_produced: number; month_dispatched: number;
      near_exhausted_letters: string[];
    };

    type PlantReport = { plant_id: string; plant_name: string; pos: POReport[]; summary: { total_ordered: number; total_produced: number; total_dispatched: number; active_pos: number; closed_pos: number; month_produced: number; month_dispatched: number } };

    const plantReports: PlantReport[] = [];
    let grandTotalOrdered = 0, grandTotalProduced = 0, grandTotalDispatched = 0;
    let grandMonthProduced = 0, grandMonthDispatched = 0;

    for (const plant of plants) {
      const plantPOs = (pos || []).filter((p) => p.plant_id === plant.id && !p.is_system_unallocated);
      if (!plantPOs.length) continue;

      const poReports: POReport[] = [];

      for (const po of plantPOs) {
        const openingProduced = (po.opening_produced_31 || 0) + (po.opening_produced_36 || 0) + (po.opening_produced_45 || 0) + (po.opening_produced_meter || 0);
        const produced_total = openingProduced + (allProdByPO[po.id] || 0);
        const ordered = (po.ordered_31 || 0) + (po.ordered_36 || 0) + (po.ordered_45 || 0) + (po.ordered_meter || 0);
        const poLetters = lettersByPO[po.id] || [];
        const dispatched_total = poLetters.reduce((s, l) => s + (allDispByLetter[l.id] || 0), 0);
        const month_dispatched = poLetters.reduce((s, l) => s + (monthDispByLetter[l.id] || 0), 0);
        const in_stock = Math.max(0, produced_total - dispatched_total);
        const fulfillment_pct = ordered > 0 ? (dispatched_total / ordered) * 100 : 0;
        const production_pct = ordered > 0 ? (produced_total / ordered) * 100 : 0;
        const month_produced = monthProdByPO[po.id] || 0;

        // Near-exhausted letters (< 10% remaining)
        const near_exhausted_letters: string[] = [];
        for (const l of poLetters) {
          const auth = (l.qty_31 || 0) + (l.qty_36 || 0) + (l.qty_45 || 0) + (l.qty_meter || 0);
          const disp = allDispByLetter[l.id] || 0;
          const rem = Math.max(0, auth - disp);
          if (auth > 0 && rem / auth < 0.1) {
            const cName = (Array.isArray(l.contractors) ? l.contractors[0] : l.contractors as { name?: string } | null)?.name || "";
            near_exhausted_letters.push(`#${l.letter_number}${cName ? ` (${cName})` : ""}`);
          }
        }

        poReports.push({ po_id: po.id, customer_name: po.customer_name, po_number: po.po_number, po_label: po.po_label, status: po.status, is_system_unallocated: po.is_system_unallocated, ordered, produced_total, dispatched_total, in_stock, fulfillment_pct, production_pct, month_produced, month_dispatched, near_exhausted_letters });
      }

      // Sort: active first, then by fulfillment_pct descending
      poReports.sort((a, b) => {
        if (a.status !== b.status) return a.status === "Active" ? -1 : 1;
        return b.fulfillment_pct - a.fulfillment_pct;
      });

      const summary = {
        total_ordered: poReports.reduce((s, p) => s + p.ordered, 0),
        total_produced: poReports.reduce((s, p) => s + p.produced_total, 0),
        total_dispatched: poReports.reduce((s, p) => s + p.dispatched_total, 0),
        active_pos: poReports.filter((p) => p.status === "Active").length,
        closed_pos: poReports.filter((p) => p.status === "Closed").length,
        month_produced: poReports.reduce((s, p) => s + p.month_produced, 0),
        month_dispatched: poReports.reduce((s, p) => s + p.month_dispatched, 0),
      };

      grandTotalOrdered += summary.total_ordered;
      grandTotalProduced += summary.total_produced;
      grandTotalDispatched += summary.total_dispatched;
      grandMonthProduced += summary.month_produced;
      grandMonthDispatched += summary.month_dispatched;

      plantReports.push({ plant_id: plant.id, plant_name: plant.name, pos: poReports, summary });
    }

    // 6. Build HTML email
    function buildHtml(recipientName: string): string {
      const grandFulfillmentPct = grandTotalOrdered > 0 ? (grandTotalDispatched / grandTotalOrdered) * 100 : 0;

      const plantSections = plantReports.map((plant) => {
        const poPct = plant.summary.total_ordered > 0 ? (plant.summary.total_dispatched / plant.summary.total_ordered) * 100 : 0;

        const poRows = plant.pos.map((po) => {
          const isClosed = po.status === "Closed";
          const exhaustedWarning = po.near_exhausted_letters.length > 0
            ? `<div style="margin-top:6px;font-size:11px;color:#dc2626;font-weight:600">⚠ Nearly exhausted: ${po.near_exhausted_letters.join(", ")}</div>`
            : "";

          return `
          <tr style="opacity:${isClosed ? "0.6" : "1"}">
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;vertical-align:top">
              <div style="font-weight:700;font-size:13px;color:#1e293b">${po.customer_name}</div>
              <div style="font-size:12px;color:#64748b">PO #${po.po_number}${po.po_label ? ` · ${po.po_label}` : ""}${isClosed ? ' <span style="background:#f1f5f9;color:#64748b;padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700">CLOSED</span>' : ""}</div>
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;color:#64748b;white-space:nowrap">${fmtNum(po.ordered)}</td>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;white-space:nowrap">
              <div>${progressBar(po.production_pct, 120)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${fmtNum(po.produced_total)} produced</div>
              ${po.month_produced > 0 ? `<div style="font-size:11px;color:#2563eb">+${fmtNum(po.month_produced)} this month</div>` : ""}
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;white-space:nowrap">
              <div>${progressBar(po.fulfillment_pct, 120)}</div>
              <div style="font-size:11px;color:#64748b;margin-top:2px">${fmtNum(po.dispatched_total)} dispatched</div>
              ${po.month_dispatched > 0 ? `<div style="font-size:11px;color:#2563eb">+${fmtNum(po.month_dispatched)} this month</div>` : ""}
            </td>
            <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;text-align:right;font-size:13px;font-weight:700;color:${po.in_stock > 0 ? "#1e293b" : "#16a34a"};white-space:nowrap">
              ${fmtNum(po.in_stock)}
              ${exhaustedWarning}
            </td>
          </tr>`;
        }).join("");

        return `
        <h3 style="color:#1e293b;border-left:3px solid #2563eb;padding-left:10px;margin:24px 0 8px;font-size:15px">${plant.plant_name}</h3>
        <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:8px">
          <tr style="background:#f8fafc">
            <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Customer / PO</th>
            <th style="padding:8px;text-align:right;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;white-space:nowrap">Ordered</th>
            <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Production</th>
            <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Dispatched</th>
            <th style="padding:8px;text-align:right;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0;white-space:nowrap">In Stock</th>
          </tr>
          ${poRows}
          <tr style="background:#f8fafc;font-weight:700">
            <td style="padding:8px;color:#1e293b">Plant Total (${plant.summary.active_pos} active${plant.summary.closed_pos > 0 ? `, ${plant.summary.closed_pos} closed` : ""})</td>
            <td style="padding:8px;text-align:right;color:#1e293b">${fmtNum(plant.summary.total_ordered)}</td>
            <td style="padding:8px;white-space:nowrap">
              ${fmtNum(plant.summary.total_produced)} produced
              ${plant.summary.month_produced > 0 ? `<span style="color:#2563eb;font-size:11px;margin-left:4px">(+${fmtNum(plant.summary.month_produced)} this month)</span>` : ""}
            </td>
            <td style="padding:8px;white-space:nowrap">
              ${progressBar(poPct, 120)}
              ${plant.summary.month_dispatched > 0 ? `<div style="font-size:11px;color:#2563eb;margin-top:2px">+${fmtNum(plant.summary.month_dispatched)} this month</div>` : ""}
            </td>
            <td style="padding:8px;text-align:right;color:#1e293b">${fmtNum(Math.max(0, plant.summary.total_produced - plant.summary.total_dispatched))}</td>
          </tr>
        </table>`;
      }).join("");

      return `
      <p style="color:#64748b;font-size:14px;margin:0 0 16px">Monthly PO progress for <strong>${monthLabel}</strong>. All figures are cumulative from PO start date.</p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:20px;display:flex;gap:24px;flex-wrap:wrap">
        <div><div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Total Ordered</div><div style="font-size:20px;font-weight:800;color:#1e293b">${fmtNum(grandTotalOrdered)}</div></div>
        <div><div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Produced</div><div style="font-size:20px;font-weight:800;color:#2563eb">${fmtNum(grandTotalProduced)}</div></div>
        <div><div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">Dispatched</div><div style="font-size:20px;font-weight:800;color:${pctColor(grandFulfillmentPct)}">${fmtNum(grandTotalDispatched)} (${fmtPct(grandFulfillmentPct)})</div></div>
        <div><div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase">This Month</div><div style="font-size:20px;font-weight:800;color:#16a34a">${fmtNum(grandMonthProduced)} prod · ${fmtNum(grandMonthDispatched)} disp</div></div>
      </div>

      ${plantSections}

      <p style="font-size:12px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:12px">
        Hi ${recipientName} — this report runs automatically on the 1st of each month. View live data at the link below.
      </p>`;
    }

    // 7. Send to Ops Managers + Admin/CEO
    const { data: recipients } = await supabase
      .from("members")
      .select("email, first_name, last_name, name, notify_email, role, department")
      .or("role.in.(Admin,Executive),and(role.eq.Manager,department.eq.Unze Trading Ops)")
      .eq("notify_email", true);

    let sent = 0;
    for (const r of recipients || []) {
      if (!r.email) continue;
      const rName = `${r.first_name || ""} ${r.last_name || ""}`.trim() || r.name || r.email;
      await sendNotificationEmail({
        to: r.email,
        subject: `Monthly PO Report — ${monthLabel}`,
        heading: `Monthly PO Progress — ${monthLabel}`,
        body: buildHtml(rName),
        linkUrl: `${APP_URL}/stock`,
        linkLabel: "View Live Stock",
        triggerType: "monthly_po_report",
        recipientName: rName,
      });
      sent++;
    }

    return Response.json({
      ok: true,
      reportMonth: reportMonthStr,
      plants: plantReports.length,
      totalPOs: plantReports.reduce((s, p) => s + p.pos.length, 0),
      grandTotals: { ordered: grandTotalOrdered, produced: grandTotalProduced, dispatched: grandTotalDispatched, fulfillment_pct: Math.round(grandTotalOrdered > 0 ? (grandTotalDispatched / grandTotalOrdered) * 100 : 0) },
      emailsSent: sent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Monthly PO report error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
