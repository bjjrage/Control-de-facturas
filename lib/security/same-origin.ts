export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.split(",", 1)[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  const protocol = forwardedProto || new URL(request.url).protocol.replace(":", "");
  if (!origin || !host) throw new Error("CSRF origin check failed");
  const originUrl = new URL(origin);
  if (originUrl.host !== host || originUrl.protocol !== `${protocol}:`) {
    throw new Error("CSRF origin check failed");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw new Error("CSRF fetch-site check failed");
  }
}
