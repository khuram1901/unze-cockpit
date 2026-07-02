export function whatsappLink(phone: string | null, message: string): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9+]/g, "");
  if (clean.length < 10) return null;
  const number = clean.startsWith("+") ? clean.slice(1) : clean.startsWith("0") ? "92" + clean.slice(1) : clean;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function dispatchNotificationMessage({
  contractorName,
  letterNumber,
  customerName,
  poNumber,
  plantName,
  qty31, qty36, qty45, qtyMeter,
  vehicleNumber,
  releasedBy,
  dispatchDate,
}: {
  contractorName: string;
  letterNumber: string;
  customerName: string;
  poNumber: string;
  plantName: string;
  qty31: number; qty36: number; qty45: number; qtyMeter: number;
  vehicleNumber: string | null;
  releasedBy: string;
  dispatchDate: string;
}): string {
  const sizes = [
    qty31 > 0 ? `${qty31} × 31ft` : null,
    qty36 > 0 ? `${qty36} × 36ft` : null,
    qty45 > 0 ? `${qty45} × 45ft` : null,
    qtyMeter > 0 ? `${qtyMeter} × Mtr` : null,
  ].filter(Boolean).join(", ");

  let msg = `*Dispatch Notification — Unze Group*\n\n`;
  msg += `Dear ${contractorName},\n\n`;
  msg += `Poles have been dispatched against your authority letter.\n\n`;
  msg += `*Letter No:* ${letterNumber}\n`;
  msg += `*PO:* ${customerName} — ${poNumber}\n`;
  msg += `*Plant:* ${plantName}\n`;
  msg += `*Date:* ${dispatchDate}\n`;
  msg += `*Quantity:* ${sizes}\n`;
  if (vehicleNumber) msg += `*Vehicle:* ${vehicleNumber}\n`;
  msg += `*Released by:* ${releasedBy}\n\n`;
  msg += `Please arrange collection at your earliest convenience.`;
  return msg;
}

export function taskReminderMessage(description: string, dueDate: string | null, assignedBy: string | null): string {
  let msg = `Task Reminder: ${description}`;
  if (dueDate) msg += `\nDue: ${dueDate}`;
  if (assignedBy) msg += `\nAssigned by: ${assignedBy}`;
  msg += `\n\nPlease check Unze Group Dashboard for details.`;
  return msg;
}

export function taskChaseMessage(description: string, assignedTo: string | null, dueDate: string | null): string {
  let msg = `Hi ${assignedTo || "there"}, this is a reminder about your task:`;
  msg += `\n\n${description}`;
  if (dueDate) msg += `\nDue: ${dueDate}`;
  msg += `\n\nPlease update the status on Unze Group Dashboard.`;
  return msg;
}
