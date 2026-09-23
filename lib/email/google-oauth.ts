import { createHash, randomBytes } from "node:crypto";
import { GMAIL_IDENTITY_SCOPES, GMAIL_SEND_SCOPE } from "./types";

export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_GMAIL_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Gmail OAuth no está configurado: faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET o GOOGLE_GMAIL_REDIRECT_URI");
  }
  return { clientId, clientSecret, redirectUri };
}
function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export function createOAuthState() {
  const state = base64Url(randomBytes(32));
  const codeVerifier = base64Url(randomBytes(48));
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  return { state, stateHash: hashOAuthState(state), codeVerifier, codeChallenge };
}

export function buildGoogleAuthorizationUrl(params: { state: string; codeChallenge: string }) {
  const config = googleOAuthConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: [GMAIL_SEND_SCOPE, ...GMAIL_IDENTITY_SCOPES].join(" "),
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

export async function exchangeGoogleCode(params: { code: string; codeVerifier: string }) {
  const config = googleOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: params.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: params.codeVerifier,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(`Google OAuth no devolvió credenciales utilizables (${payload.error ?? "token_exchange_failed"})`);
  }
  const scopes = (payload.scope ?? "").split(/\s+/u).filter(Boolean);
  if (!scopes.includes(GMAIL_SEND_SCOPE)) throw new Error("La cuenta no concedió el scope mínimo gmail.send");
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token, scopes };
}

export async function fetchGoogleIdentity(accessToken: string): Promise<string | null> {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const payload = (await response.json().catch(() => ({}))) as { email?: string };
  return typeof payload.email === "string" ? payload.email : null;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    cache: "no-store",
  });
  if (!response.ok && response.status !== 400) throw new Error("Google no confirmó la revocación OAuth");
}
