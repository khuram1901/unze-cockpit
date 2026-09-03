// PUBLIC ROUTE — intentionally unauthenticated at the HTTP level.
// Initiates the Google OAuth flow for the notifications Gmail account.
// Admin-only: visited manually by the system administrator, not linked
// from any user-facing page. Same security model as google/auth:
// the callback rejects any account other than the designated one.

export async function GET() {
  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
  ];

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: (process.env.GOOGLE_REDIRECT_URI || "").replace("/callback", "/callback-notifications"),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: "k.saleem@unzegroup.com",
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return Response.redirect(url);
}
