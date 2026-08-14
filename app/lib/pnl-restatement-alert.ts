import { sendNotificationEmail } from "./send-email";

// Immediate CEO alert when a P&L upload changes previously-confirmed figures.
// The restatement is already permanently logged in pnl_restatements — this
// makes sure Khuram hears about it straight away rather than only when he
// next opens the page. Deliberately NOT a digest-covered trigger type:
// restatements are rare and serious enough to warrant their own email.
//
// Fire-and-forget from the upload routes: an email failure must never fail
// the upload itself (the log is the source of truth; the email is a courtesy).

const CEO_EMAIL = "khuram1901@gmail.com";

export type RestatementItem = {
  month: string; // YYYY-MM-01
  scope: string; // branch or plant
  line: string;
  old_value: number;
  new_value: number;
};

function money(n: number): string {
  return Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}m` : Math.round(n).toLocaleString();
}
// DD/MM/YYYY per house rule (no imports available in email HTML context,
// so the same split-reverse-join used in other API-route emails).
function ukDate(iso: string): string {
  return iso.split("-").reverse().join("/");
}

export async function sendRestatementAlert({
  companyLabel,
  pagePath,
  uploadedBy,
  fileName,
  items,
}: {
  companyLabel: string; // "Unze Trading" | "Imperial Footwear" | "Baranh" | "Haute Dolci"
  pagePath: string; // e.g. "/finance/imperial-pnl"
  uploadedBy: string;
  fileName: string;
  items: RestatementItem[];
}) {
  if (items.length === 0) return;
  try {
    const shown = items.slice(0, 20);
    const rows = shown
      .map(
        (r) =>
          `<li style="margin-bottom:6px"><strong>${r.scope}</strong> — ${r.line}, month ${ukDate(r.month)}: ` +
          `PKR ${money(r.old_value)} &rarr; PKR ${money(r.new_value)} ` +
          `(change ${money(r.new_value - r.old_value)})</li>`,
      )
      .join("");
    const more = items.length > shown.length ? `<p>…and ${items.length - shown.length} more — see the Restatement log on the page.</p>` : "";
    const body =
      `<p>An upload to the <strong>${companyLabel} P&amp;L</strong> has changed figures that were previously stored and confirmed.</p>` +
      `<p><strong>Uploaded by:</strong> ${uploadedBy}<br/><strong>File:</strong> ${fileName}</p>` +
      `<ul style="padding-left:18px">${rows}</ul>` +
      more +
      `<p>Every change is permanently recorded in the Restatement log. If this change was not expected, speak to the uploader and check the source file.</p>`;

    await sendNotificationEmail({
      to: CEO_EMAIL,
      subject: `⚠ ${companyLabel} P&L: ${items.length} previously-confirmed figure${items.length > 1 ? "s" : ""} changed`,
      heading: "Restated figures detected",
      body,
      linkUrl: `https://pulse.unze.co.uk${pagePath}`,
      linkLabel: "Open the Restatement log",
      triggerType: "pnl_restatement",
    });
  } catch (err) {
    console.error("[pnl-restatement-alert] email failed (upload unaffected):", err);
  }
}
