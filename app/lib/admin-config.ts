/**
 * Central admin / system-account configuration.
 *
 * Update this file — not individual route files — when the admin list changes.
 * ADMIN_EMAILS: users who have full admin access to sensitive API routes.
 * BACKUP_OWNER: the Google account whose OAuth token is used for Drive backup uploads.
 */

export const ADMIN_EMAILS: string[] = [
  "khuram1901@gmail.com",
  "k.saleem@unzegroup.com",
];

/** Returns true if the given email is an admin. Case-insensitive. */
export function isAdmin(email: string): boolean {
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/** The Drive / Google account that owns the backup folder. */
export const BACKUP_OWNER = "k.saleem@unzegroup.com";
