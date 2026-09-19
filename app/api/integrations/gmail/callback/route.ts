import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { actorFromProfile } from "@/lib/agent/context";
import { recordEmailEvent } from "@/lib/email/domain-service";
import { exchangeGoogleCode, fetchGoogleIdentity, hashOAuthState } from "@/lib/email/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function resultRedirect(request: Request, result: string) {
  const url = new URL("/configuracion", request.url);
  url.searchParams.set("email", result);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state")?.trim();
  const code = url.searchParams.get("code")?.trim();
  if (!state || !code) return resultRedirect(request, "gmail_error");
  try {
    const profile = await requireProfile(["comercial", "admin"]);
    const db = await createClient();
    const { data: stateRow, error: stateError } = await db
      .from("email_oauth_states")
      .select("id, code_verifier, provider")
      .eq("state_hash", hashOAuthState(state))
      .eq("empresa_id", profile.empresa_id)
      .eq("user_id", profile.id)
      .eq("provider", "GMAIL")
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (stateError || !stateRow) return resultRedirect(request, "gmail_state_invalid");
    const consumed = await db
      .from("email_oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("id", stateRow.id)
      .eq("user_id", profile.id)
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();
    if (consumed.error || !consumed.data) return resultRedirect(request, "gmail_state_replayed");

    const tokens = await exchangeGoogleCode({ code, codeVerifier: stateRow.code_verifier as string });
    const providerEmail = await fetchGoogleIdentity(tokens.accessToken);
    if (!providerEmail) {
      return resultRedirect(request, "gmail_identity_unavailable");
    }
    const admin = createAdminClient();
    const { data: connectionId, error: connectionError } = await admin.rpc("email_connect_gmail", {
      p_empresa_id: profile.empresa_id,
      p_user_id: profile.id,
      p_provider_email: providerEmail,
      p_scopes: tokens.scopes,
      p_refresh_token: tokens.refreshToken,
    });
    if (connectionError || typeof connectionId !== "string") {
      return resultRedirect(request, "gmail_vault_unavailable");
    }
    await recordEmailEvent(db, actorFromProfile(profile), {
      eventType: "email.connection.created",
      connectionId,
      metadata: { provider: "GMAIL", scopes: tokens.scopes, providerEmail: providerEmail ?? null },
    });
    return resultRedirect(request, "gmail_connected");
  } catch {
    return resultRedirect(request, "gmail_error");
  }
}
