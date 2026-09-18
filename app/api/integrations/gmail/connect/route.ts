import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildGoogleAuthorizationUrl, createOAuthState } from "@/lib/email/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function connect() {
  const profile = await requireProfile(["comercial", "admin"]);
  const db = await createClient();
  const oauth = createOAuthState();
  await db
    .from("email_oauth_states")
    .delete()
    .eq("empresa_id", profile.empresa_id)
    .eq("user_id", profile.id)
    .lt("expires_at", new Date().toISOString());
  const { error } = await db.from("email_oauth_states").insert({
    empresa_id: profile.empresa_id,
    user_id: profile.id,
    provider: "GMAIL",
    state_hash: oauth.stateHash,
    code_verifier: oauth.codeVerifier,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ error: "No se pudo iniciar la conexión Gmail" }, { status: 500 });
  return NextResponse.redirect(buildGoogleAuthorizationUrl({ state: oauth.state, codeChallenge: oauth.codeChallenge }));
}
export async function GET() {
  try {
    return await connect();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conectar Gmail" }, { status: 503 });
  }
}

export async function POST() {
  return GET();
}
