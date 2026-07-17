// Folderit API auth — OpenID Connect client-credentials flow.
//
// Folderit publishes an OIDC discovery document rather than a fixed token
// URL, so we resolve the real token_endpoint once and cache it, instead of
// hardcoding it (confirmed live: https://auth.folderit.com/oauth2/token as
// of 2026-07-12, but treat that as an implementation detail that can move).

const DISCOVERY_URL = "https://auth.folderit.com/.well-known/openid-configuration";
export const FOLDERIT_API_BASE = "https://api.folderit.com";

let cachedTokenEndpoint: string | null = null;
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

async function getTokenEndpoint(): Promise<string> {
  if (cachedTokenEndpoint) return cachedTokenEndpoint;
  const res = await fetch(DISCOVERY_URL, { next: { revalidate: 86400 } });
  if (!res.ok) throw new Error(`Folderit discovery fetch failed: ${res.status}`);
  const json = await res.json();
  if (!json.token_endpoint) throw new Error("Folderit discovery doc missing token_endpoint");
  cachedTokenEndpoint = json.token_endpoint as string;
  return cachedTokenEndpoint;
}

export async function getFolderitToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.accessToken;
  }

  const clientId = process.env.FOLDERIT_CLIENT_ID;
  const clientSecret = process.env.FOLDERIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing FOLDERIT_CLIENT_ID or FOLDERIT_CLIENT_SECRET");
  }

  const tokenUrl = await getTokenEndpoint();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Folderit token exchange failed: ${res.status} ${body}`);
  }

  const json = await res.json();
  const expiresInSec = typeof json.expires_in === "number" ? json.expires_in : 3600;
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: now + expiresInSec * 1000,
  };
  return cachedToken.accessToken;
}

// Thin wrapper for authenticated Folderit API calls.
export async function folderitFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getFolderitToken();
  return fetch(`${FOLDERIT_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

// A handful of Folderit endpoints (e.g. GET /audit/accountLog) document
// their filters as a JSON request body on a GET request. The standard
// fetch() API refuses to send a body on GET/HEAD — that's a restriction of
// the WHATWG Fetch spec, not of HTTP itself — so calling folderitFetch()
// with a GET + body throws "Request with GET/HEAD method cannot have body"
// before the request ever leaves the machine. This helper drops down to
// Node's raw https client, which has no such restriction, for those
// specific calls only. Keep using folderitFetch() for every ordinary
// (body-less) GET.
export async function folderitGetWithBody(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const token = await getFolderitToken();
  const payload = JSON.stringify(body);
  const https = await import("node:https");

  return new Promise((resolve, reject) => {
    const req = https.request(
      `${FOLDERIT_API_BASE}${path}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 500;
          resolve({
            ok: status < 400,
            status,
            json: async () => (raw ? JSON.parse(raw) : null),
          });
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}
