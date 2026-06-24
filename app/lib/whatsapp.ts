export function whatsappLink(phone: string | null, message: string): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[^0-9+]/g, "");
  if (clean.length < 10) return null;
  const number = clean.startsWith("+") ? clean.slice(1) : clean.startsWith("0") ? "92" + clean.slice(1) : clean;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
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
