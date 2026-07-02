import { NextRequest } from "next/server";
import { createServiceClient } from "../../../lib/supabase-server";
import { requireAuth } from "../../../lib/api-auth";
import { sendNotificationEmail } from "../../../lib/send-email";
import { dispatchNotificationMessage, whatsappLink } from "../../../lib/whatsapp";

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const { searchParams } = new URL(request.url);
  const letterId = searchParams.get("letterId");

  if (!letterId) return Response.json({ error: "letterId is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("dispatch_records")
    .select("*")
    .eq("authority_letter_id", letterId)
    .order("dispatch_date", { ascending: false });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ dispatches: data || [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const supabase = createServiceClient();
  const body = await request.json().catch(() => ({}));
  const {
    authority_letter_id,
    dispatch_date,
    qty_31 = 0, qty_36 = 0, qty_45 = 0, qty_meter = 0,
    released_by,
    vehicle_number,
    notes,
  } = body;

  if (!authority_letter_id || !released_by) {
    return Response.json({ error: "authority_letter_id and released_by are required" }, { status: 400 });
  }

  // Fetch letter to validate dispatch cap
  const { data: letter } = await supabase
    .from("authority_letters")
    .select("qty_31, qty_36, qty_45, qty_meter, opening_dispatched_31, opening_dispatched_36, opening_dispatched_45, opening_dispatched_meter")
    .eq("id", authority_letter_id)
    .single();

  if (!letter) return Response.json({ error: "Authority letter not found" }, { status: 404 });

  // Sum existing dispatch records for this letter
  const { data: existing } = await supabase
    .from("dispatch_records")
    .select("qty_31, qty_36, qty_45, qty_meter")
    .eq("authority_letter_id", authority_letter_id);

  const alreadyDispatched = (existing || []).reduce(
    (acc, r) => ({
      qty_31: acc.qty_31 + (r.qty_31 || 0),
      qty_36: acc.qty_36 + (r.qty_36 || 0),
      qty_45: acc.qty_45 + (r.qty_45 || 0),
      qty_meter: acc.qty_meter + (r.qty_meter || 0),
    }),
    {
      qty_31: letter.opening_dispatched_31 || 0,
      qty_36: letter.opening_dispatched_36 || 0,
      qty_45: letter.opening_dispatched_45 || 0,
      qty_meter: letter.opening_dispatched_meter || 0,
    }
  );

  // Hard block: dispatch cannot exceed letter qty per size
  const overflows = [
    { size: "31ft", total: alreadyDispatched.qty_31 + qty_31, limit: letter.qty_31 },
    { size: "36ft", total: alreadyDispatched.qty_36 + qty_36, limit: letter.qty_36 },
    { size: "45ft", total: alreadyDispatched.qty_45 + qty_45, limit: letter.qty_45 },
    { size: "meter", total: alreadyDispatched.qty_meter + qty_meter, limit: letter.qty_meter },
  ].filter((s) => s.limit > 0 && s.total > s.limit);

  if (overflows.length > 0) {
    const detail = overflows.map((s) => {
      const remaining = s.limit - (s.total - (s.size === "31ft" ? qty_31 : s.size === "36ft" ? qty_36 : s.size === "45ft" ? qty_45 : qty_meter));
      return `${s.size}: only ${remaining} remaining on this letter`;
    }).join(", ");
    return Response.json({ error: `Dispatch blocked — ${detail}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dispatch_records")
    .insert({
      authority_letter_id,
      dispatch_date: dispatch_date || new Date().toISOString().slice(0, 10),
      qty_31, qty_36, qty_45, qty_meter,
      released_by, vehicle_number: vehicle_number || null,
      notes: notes || null, created_by: auth.email,
    })
    .select().single();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Check if the parent PO should now auto-close
  // (total dispatched across all letters >= PO ordered qty for all sizes)
  try {
    const { data: letterInfo } = await supabase
      .from("authority_letters")
      .select("po_id")
      .eq("id", authority_letter_id)
      .single();

    if (letterInfo?.po_id) {
      const { data: po } = await supabase
        .from("purchase_orders")
        .select("id, ordered_31, ordered_36, ordered_45, ordered_meter, opening_produced_31, opening_produced_36, opening_produced_45, opening_produced_meter, status, is_system_unallocated")
        .eq("id", letterInfo.po_id)
        .single();

      if (po && !po.is_system_unallocated && po.status === "Active") {
        const { data: allLetters } = await supabase
          .from("authority_letters")
          .select("qty_31, qty_36, qty_45, qty_meter, opening_dispatched_31, opening_dispatched_36, opening_dispatched_45, opening_dispatched_meter, dispatch_records(qty_31, qty_36, qty_45, qty_meter)")
          .eq("po_id", po.id);

        const totalDispatched = (allLetters || []).reduce(
          (acc, l) => {
            const letterDisp = (l.dispatch_records || []).reduce(
              (la: { qty_31: number; qty_36: number; qty_45: number; qty_meter: number }, dr: { qty_31: number; qty_36: number; qty_45: number; qty_meter: number }) => ({
                qty_31: la.qty_31 + (dr.qty_31 || 0),
                qty_36: la.qty_36 + (dr.qty_36 || 0),
                qty_45: la.qty_45 + (dr.qty_45 || 0),
                qty_meter: la.qty_meter + (dr.qty_meter || 0),
              }),
              { qty_31: l.opening_dispatched_31 || 0, qty_36: l.opening_dispatched_36 || 0, qty_45: l.opening_dispatched_45 || 0, qty_meter: l.opening_dispatched_meter || 0 }
            );
            return {
              qty_31: acc.qty_31 + letterDisp.qty_31,
              qty_36: acc.qty_36 + letterDisp.qty_36,
              qty_45: acc.qty_45 + letterDisp.qty_45,
              qty_meter: acc.qty_meter + letterDisp.qty_meter,
            };
          },
          { qty_31: 0, qty_36: 0, qty_45: 0, qty_meter: 0 }
        );

        const sizes = ["31", "36", "45", "meter"] as const;
        const fullyDelivered = sizes.every((s) => {
          const ordered = po[`ordered_${s}` as keyof typeof po] as number;
          if (!ordered || ordered <= 0) return true;
          return (totalDispatched[`qty_${s}` as keyof typeof totalDispatched] as number) >= ordered;
        });

        if (fullyDelivered) {
          await supabase.from("purchase_orders").update({ status: "Closed", updated_at: new Date().toISOString() }).eq("id", po.id);
        }
      }
    }
  } catch {
    // Auto-close failure is non-fatal — log only
    console.error("dispatch-records: auto-close PO check failed");
  }

  // Fire dispatch notification (non-fatal — never blocks the dispatch)
  try {
    // Fetch full context: letter → PO → contractor → plant
    const { data: letterFull } = await supabase
      .from("authority_letters")
      .select("letter_number, contractor_id, po_id, contractors(name, contact_phone), purchase_orders(customer_name, po_number, plant_id, plant_name)")
      .eq("id", authority_letter_id)
      .single();

    if (letterFull) {
      const contractor = (Array.isArray(letterFull.contractors) ? letterFull.contractors[0] : letterFull.contractors) as { name: string; contact_phone: string | null } | null;
      const po = (Array.isArray(letterFull.purchase_orders) ? letterFull.purchase_orders[0] : letterFull.purchase_orders) as { customer_name: string; po_number: string; plant_id: string; plant_name: string } | null;

      if (contractor && po) {
        const msgText = dispatchNotificationMessage({
          contractorName: contractor.name,
          letterNumber: letterFull.letter_number,
          customerName: po.customer_name,
          poNumber: po.po_number,
          plantName: po.plant_name,
          qty31: qty_31, qty36: qty_36, qty45: qty_45, qtyMeter: qty_meter,
          vehicleNumber: vehicle_number || null,
          releasedBy: released_by,
          dispatchDate: dispatch_date || new Date().toISOString().slice(0, 10),
        });

        const waLink = whatsappLink(contractor.contact_phone, msgText);

        // Find Ops Managers for this plant who have email notifications enabled
        const { data: opsManagers } = await supabase
          .from("members")
          .select("email, first_name, last_name, name, notify_email, notify_whatsapp, phone_e164")
          .eq("department", "Unze Trading Ops")
          .eq("role", "Manager")
          .eq("notify_email", true);

        const totalQty = qty_31 + qty_36 + qty_45 + qty_meter;
        const sizes = [
          qty_31 > 0 ? `${qty_31} × 31ft` : null,
          qty_36 > 0 ? `${qty_36} × 36ft` : null,
          qty_45 > 0 ? `${qty_45} × 45ft` : null,
          qty_meter > 0 ? `${qty_meter} × Mtr` : null,
        ].filter(Boolean).join(", ");

        const waButtonHtml = waLink
          ? `<p style="margin-top:16px"><a href="${waLink}" style="background:#25D366;color:white;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px">Send WhatsApp to ${contractor.name}</a></p>`
          : contractor.contact_phone
          ? `<p style="font-size:13px;color:#64748b">Contractor phone: ${contractor.contact_phone} (no WhatsApp link — number not in international format)</p>`
          : `<p style="font-size:13px;color:#64748b">No phone number on file for this contractor.</p>`;

        for (const mgr of opsManagers || []) {
          const mgrName = `${mgr.first_name || ""} ${mgr.last_name || ""}`.trim() || mgr.name || mgr.email;
          await sendNotificationEmail({
            to: mgr.email,
            subject: `[Dispatch] ${contractor.name} — ${po.customer_name} PO#${po.po_number}`,
            heading: "Dispatch Recorded",
            body: `
              <p>Hi <strong>${mgrName}</strong>,</p>
              <p>A dispatch has been recorded against authority letter <strong>${letterFull.letter_number}</strong>.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;margin:12px 0">
                <tr><td style="padding:5px 8px;color:#64748b;width:40%">Contractor</td><td style="padding:5px 8px;font-weight:600">${contractor.name}</td></tr>
                <tr style="background:#f8fafc"><td style="padding:5px 8px;color:#64748b">PO</td><td style="padding:5px 8px;font-weight:600">${po.customer_name} — ${po.po_number}</td></tr>
                <tr><td style="padding:5px 8px;color:#64748b">Plant</td><td style="padding:5px 8px">${po.plant_name}</td></tr>
                <tr style="background:#f8fafc"><td style="padding:5px 8px;color:#64748b">Quantity</td><td style="padding:5px 8px;font-weight:600">${sizes} (${totalQty} poles)</td></tr>
                ${vehicle_number ? `<tr><td style="padding:5px 8px;color:#64748b">Vehicle</td><td style="padding:5px 8px">${vehicle_number}</td></tr>` : ""}
                <tr style="background:#f8fafc"><td style="padding:5px 8px;color:#64748b">Released by</td><td style="padding:5px 8px">${released_by}</td></tr>
              </table>
              <p style="margin:12px 0 4px;font-weight:600;color:#1e293b">Notify the contractor via WhatsApp:</p>
              <p style="font-size:13px;color:#64748b;margin:0 0 8px">Tap the button below to open WhatsApp with a pre-filled message ready to send to ${contractor.name}.</p>
              ${waButtonHtml}
            `,
            linkUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://unze-cockpit.vercel.app"}/stock`,
            linkLabel: "View Stock",
            triggerType: "dispatch_notification",
            triggerRecordId: data?.id,
            recipientName: mgrName,
          });
        }
      }
    }
  } catch (err) {
    console.error("dispatch-records: notification failed:", err instanceof Error ? err.message : err);
  }

  return Response.json({ dispatch: data }, { status: 201 });
}
