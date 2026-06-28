import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { sendNotificationEmail } from "../../../lib/send-email";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const supabase = createServiceClient();
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const since = weekAgo.toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    const month = now.toISOString().slice(0, 7);

    // Tasks
    const { data: allTasks } = await supabase.from("tasks").select("*");
    const tasks = allTasks || [];
    const openTasks = tasks.filter((t) => t.status !== "Completed" && t.status !== "Cancelled");
    const overdue = openTasks.filter((t) => t.due_date && t.due_date < today);
    const completedThisWeek = tasks.filter((t) => t.status === "Completed" && t.updated_at && t.updated_at.slice(0, 10) >= since);
    const createdThisWeek = tasks.filter((t) => t.created_at && t.created_at.slice(0, 10) >= since);
    const waitingReply = openTasks.filter((t) => t.status === "Waiting Reply");

    // Production
    const { data: prodData } = await supabase.from("production_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", since).lte("entry_date", today);
    const totalProduced = (prodData || []).reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

    const { data: dispData } = await supabase.from("dispatch_entries").select("qty_31, qty_36, qty_45, qty_meter").gte("entry_date", since).lte("entry_date", today);
    const totalDispatched = (dispData || []).reduce((s, r) => s + (r.qty_31 || 0) + (r.qty_36 || 0) + (r.qty_45 || 0) + (r.qty_meter || 0), 0);

    // Finance
    const { data: cashPos } = await supabase.from("daily_cash_position").select("closing_balance, total_receipts, total_payments, position_date").gte("position_date", since).order("position_date", { ascending: false });
    const latestCash = cashPos?.[0];
    const weekReceipts = (cashPos || []).reduce((s, r) => s + (r.total_receipts || 0), 0);
    const weekPayments = (cashPos || []).reduce((s, r) => s + (r.total_payments || 0), 0);

    // Escalations
    const escalations = openTasks.filter((t) => t.source_type === "kpi_escalation" || t.source_type === "receivable_escalation");

    // Machine issues
    const { data: machines } = await supabase.from("machine_issues").select("*").neq("issue_status", "Resolved");
    const machineDown = (machines || []).filter((m) => m.issue_status === "Down");

    // Receivables
    const { data: recData } = await supabase.from("receivables").select("amount, status");
    const totalReceivables = (recData || []).reduce((s, r) => s + (r.amount || 0), 0);
    const collectedReceivables = (recData || []).filter((r) => r.status === "Collected").reduce((s, r) => s + (r.amount || 0), 0);

    // Per-person task load for top assignees
    const personLoad = new Map<string, { open: number; overdue: number }>();
    for (const t of openTasks) {
      const p = t.assigned_to || "Unassigned";
      if (!personLoad.has(p)) personLoad.set(p, { open: 0, overdue: 0 });
      personLoad.get(p)!.open++;
      if (t.due_date && t.due_date < today) personLoad.get(p)!.overdue++;
    }
    const topPeople = Array.from(personLoad.entries())
      .map(([name, d]) => ({ name, ...d }))
      .sort((a, b) => b.overdue - a.overdue || b.open - a.open)
      .slice(0, 5);

    // HTML bar helper — email-safe inline bar chart using table cells
    function htmlBar(items: { label: string; value: number; color: string }[], maxWidth = 300) {
      const max = Math.max(...items.map((i) => i.value), 1);
      return `<table style="border-collapse:collapse;width:100%;max-width:500px;font-size:13px;margin:8px 0 16px">
        ${items.map((item) => {
          const w = Math.round((item.value / max) * maxWidth);
          return `<tr>
            <td style="padding:3px 8px 3px 0;color:#64748b;white-space:nowrap;width:120px">${item.label}</td>
            <td style="padding:3px 0">
              <div style="background:${item.color};height:18px;width:${Math.max(w, 2)}px;border-radius:3px;display:inline-block;vertical-align:middle"></div>
              <span style="margin-left:6px;font-weight:700;color:${item.color}">${item.value.toLocaleString()}</span>
            </td>
          </tr>`;
        }).join("")}
      </table>`;
    }

    // Build HTML report
    const html = `
      <h2 style="color:#1e293b;margin:0 0 12px">Weekly Report</h2>
      <p style="color:#64748b;font-size:14px">Week ending ${today} (from ${since})</p>

      <h3 style="color:#1e293b;border-left:3px solid #1e293b;padding-left:8px;margin:20px 0 8px">Tasks Overview</h3>
      ${htmlBar([
        { label: "Created", value: createdThisWeek.length, color: "#2563eb" },
        { label: "Completed", value: completedThisWeek.length, color: "#16a34a" },
        { label: "Overdue", value: overdue.length, color: "#dc2626" },
        { label: "Waiting Reply", value: waitingReply.length, color: "#d97706" },
        { label: "Escalations", value: escalations.length, color: "#7c3aed" },
      ])}
      <table style="border-collapse:collapse;width:100%;max-width:500px;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:4px 8px;color:#64748b">Total open</td><td style="padding:4px 8px;font-weight:700;color:#2563eb">${openTasks.length}</td></tr>
      </table>

      <h3 style="color:#1e293b;border-left:3px solid #1e293b;padding-left:8px;margin:20px 0 8px">Production</h3>
      ${htmlBar([
        { label: "Produced", value: totalProduced, color: "#16a34a" },
        { label: "Dispatched", value: totalDispatched, color: "#059669" },
      ])}
      <table style="border-collapse:collapse;width:100%;max-width:500px;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:4px 8px;color:#64748b">Machines down</td><td style="padding:4px 8px;font-weight:700;color:${machineDown.length > 0 ? "#dc2626" : "#16a34a"}">${machineDown.length}</td></tr>
      </table>

      <h3 style="color:#1e293b;border-left:3px solid #1e293b;padding-left:8px;margin:20px 0 8px">Finance</h3>
      ${htmlBar([
        { label: "Receipts", value: weekReceipts, color: "#16a34a" },
        { label: "Payments", value: weekPayments, color: "#dc2626" },
      ])}
      <table style="border-collapse:collapse;width:100%;max-width:500px;font-size:14px;margin-bottom:16px">
        <tr><td style="padding:4px 8px;color:#64748b">Cash balance</td><td style="padding:4px 8px;font-weight:700;color:#1e293b">PKR ${latestCash ? latestCash.closing_balance.toLocaleString() : "—"}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Net this week</td><td style="padding:4px 8px;font-weight:700;color:${weekReceipts - weekPayments >= 0 ? "#16a34a" : "#dc2626"}">PKR ${(weekReceipts - weekPayments).toLocaleString()}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Receivables</td><td style="padding:4px 8px;font-weight:700;color:#1e293b">PKR ${totalReceivables.toLocaleString()} (${collectedReceivables > 0 ? Math.round(collectedReceivables / totalReceivables * 100) : 0}% collected)</td></tr>
      </table>

      ${topPeople.length > 0 ? `
      <h3 style="color:#1e293b;border-left:3px solid #1e293b;padding-left:8px;margin:20px 0 8px">Task Load by Person</h3>
      ${htmlBar(topPeople.map((p) => ({ label: p.name.split(" ")[0], value: p.open, color: p.overdue > 0 ? "#dc2626" : "#2563eb" })))}
      ` : ""}

      ${overdue.length > 0 ? `
      <h3 style="color:#dc2626;border-left:3px solid #dc2626;padding-left:8px;margin:20px 0 8px">Top Overdue Tasks</h3>
      <ul style="padding-left:20px;font-size:13px;color:#1e293b">
        ${overdue.slice(0, 5).map((t) => `<li style="margin-bottom:4px">${t.description} — ${t.assigned_to || "Unassigned"} (due ${t.due_date})</li>`).join("")}
      </ul>
      ` : ""}
    `;

    // Send to admin emails
    const { data: admins } = await supabase.from("members").select("email, first_name, name").in("role", ["Admin", "Executive"]);
    let sent = 0;
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app";

    for (const admin of (admins || [])) {
      if (!admin.email) continue;
      await sendNotificationEmail({
        to: admin.email,
        subject: `Weekly Report — ${today}`,
        heading: `Weekly Report for ${admin.first_name || admin.name || "Team"}`,
        body: html,
        linkUrl: `${APP_URL}/executive`,
        linkLabel: "Open Unze Group Dashboard",
        triggerType: "weekly_report",
        recipientName: admin.first_name || admin.name || admin.email,
      });
      sent++;
    }

    return Response.json({
      ok: true,
      weekEnding: today,
      tasks: { created: createdThisWeek.length, completed: completedThisWeek.length, open: openTasks.length, overdue: overdue.length },
      production: { produced: totalProduced, dispatched: totalDispatched },
      finance: { cashBalance: latestCash?.closing_balance || 0, receipts: weekReceipts, payments: weekPayments },
      emailsSent: sent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Weekly report error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
