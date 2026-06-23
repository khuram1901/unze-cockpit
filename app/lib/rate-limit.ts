const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count };
}

export function rateLimitByIP(request: Request, maxRequests: number = 30, windowMs: number = 60000): { allowed: boolean; remaining: number } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  return rateLimit(ip, maxRequests, windowMs);
}

export function rateLimitResponse() {
  return Response.json(
    { error: "Too many requests. Please wait a moment." },
    { status: 429, headers: { "Retry-After": "60" } }
  );
}
