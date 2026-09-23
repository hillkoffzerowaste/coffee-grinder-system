export function isAllowedMutation(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const requestOrigin = new URL(request.url).origin;
    const allowedOrigins = new Set([requestOrigin]);
    const publicOrigin = process.env.APP_PUBLIC_ORIGIN;
    if (publicOrigin) allowedOrigins.add(new URL(publicOrigin).origin);
    return allowedOrigins.has(new URL(origin).origin);
  }
  catch { return false; }
}
