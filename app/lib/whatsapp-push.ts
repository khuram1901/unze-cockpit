/**
 * whatsapp-push.ts — server-side utility for sending outbound WhatsApp
 * messages via the Meta Cloud API.
 *
 * Only import this in server-side files (API routes, server components).
 * For client-side WhatsApp link helpers, use app/lib/whatsapp.ts instead.
 *
 * Env vars required:
 *   WHATSAPP_ACCESS_TOKEN   — Meta permanent/long-lived token
 *   WHATSAPP_PHONE_NUMBER_ID — the Business phone number ID from Meta dashboard
 */

const GRAPH = "https://graph.facebook.com/v20.0";

/** Normalise any phone string to E.164 digits (no leading +). */
function toE164Digits(phone: string): string {
  const clean = phone.replace(/[^0-9+]/g, "");
  if (clean.startsWith("+")) return clean.slice(1);
  if (clean.startsWith("0")) return "92" + clean.slice(1); // Pakistan default
  return clean;
}

/**
 * Send the approved `unze_dashboard_alert` template to open a conversation window.
 * Must be called before sendWhatsAppPush for recipients who have never messaged us.
 * {{1}} = recipient's first name.
 *
 * Returns { ok: true } on success or { ok: false, error } on failure.
 * Never throws.
 */
export async function sendWhatsAppTemplate(
  phone: string | null | undefined,
  firstName: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn("[whatsapp-push] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set — skipping");
    return { ok: false, error: "not_configured" };
  }

  if (!phone) return { ok: false, error: "no_phone" };

  const to = toE164Digits(phone);
  if (to.length < 10) return { ok: false, error: "invalid_phone" };

  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: "unze_dashboard_alert",
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: firstName }],
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[whatsapp-push] template API error:", err);
      return { ok: false, error: err };
    }

    return { ok: true };
  } catch (e) {
    console.error("[whatsapp-push] template fetch failed:", e);
    return { ok: false, error: String(e) };
  }
}

/**
 * Send the template opener then the rich text body.
 * Use this everywhere instead of sendWhatsAppPush to reach recipients
 * who have not recently messaged the business number.
 *
 * Returns { ok: true } on success or { ok: false, error } on failure.
 * Never throws.
 */
export async function sendWhatsAppNotification(
  phone: string | null | undefined,
  firstName: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  // Step 1: open the conversation window with the approved template
  const tpl = await sendWhatsAppTemplate(phone, firstName);
  if (!tpl.ok) return tpl;

  // Step 2: wait so Meta fully establishes the session window before free-form
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Step 3: send the actual rich message (now within the 24-hour window)
  return sendWhatsAppPush(phone, message);
}

/**
 * Send a plain-text WhatsApp message to a phone number.
 * NOTE: Only works within a 24-hour conversation window.
 * Use sendWhatsAppNotification() for first-time / cold recipients.
 *
 * Returns { ok: true } on success or { ok: false, error } on failure.
 * Never throws — callers don't need try/catch.
 */
export async function sendWhatsAppPush(
  phone: string | null | undefined,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneId) {
    console.warn("[whatsapp-push] WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set — skipping");
    return { ok: false, error: "not_configured" };
  }

  if (!phone) return { ok: false, error: "no_phone" };

  const to = toE164Digits(phone);
  if (to.length < 10) return { ok: false, error: "invalid_phone" };

  try {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message.slice(0, 4096) },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[whatsapp-push] API error:", err);
      return { ok: false, error: err };
    }

    return { ok: true };
  } catch (e) {
    console.error("[whatsapp-push] fetch failed:", e);
    return { ok: false, error: String(e) };
  }
}

/**
 * Format a task-assigned WhatsApp notification message.
 */
export function taskAssignedMessage({
  assigneeName,
  description,
  dueDate,
  assignedBy,
  priority,
}: {
  assigneeName: string;
  description: string;
  dueDate: string | null;
  assignedBy: string | null;
  priority: string | null;
}): string {
  const firstName = assigneeName.split(" ")[0];
  const duePart = dueDate
    ? `\n📅 *Due:* ${dueDate.split("-").reverse().join("/")}`
    : "";
  const priorityPart = priority && priority !== "Normal"
    ? `\n⚡ *Priority:* ${priority}`
    : "";
  const byPart = assignedBy ? `\n👤 *Assigned by:* ${assignedBy}` : "";

  return [
    `📋 *New Task — Unze Group*`,
    ``,
    `Hi ${firstName},`,
    ``,
    `You have been assigned a task:`,
    ``,
    `_${description}_`,
    `${duePart}${priorityPart}${byPart}`,
    ``,
    `Please log in to the dashboard to confirm or update status.`,
    `https://unze-cockpit.vercel.app/tasks`,
  ].join("\n");
}
