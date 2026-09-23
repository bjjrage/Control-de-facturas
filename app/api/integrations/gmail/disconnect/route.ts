import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { actorFromProfile } from "@/lib/agent/context";
import { recordEmailEvent } from "@/lib/email/domain-service";
import { revokeGoogleToken } from "@/lib/email/google-oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const profile = await requireProfile(["comercial", "admin"]);
    const db = await createClient();
    const { data: connection } = await db
      .from("email_connections")
      .select("id, provider_email, refresh_token_secret_id")
      .eq("empresa_id", profile.empresa_id)
      .eq("user_id", profile.id)
      .eq("provider", "GMAIL")
      .eq("status", "CONNECTED")
      .maybeSingle();
    if (connection) {
      const secretId = (connection as { refresh_token_secret_id: string | null }).refresh_token_secret_id;
      if (secretId) {
        const { data: refreshToken } = await db.rpc("email_read_oauth_secret", { p_connection_id: connection.id });
        if (typeof refreshToken === "string" && refreshToken) await revokeGoogleToken(refreshToken).catch(() => null);
        await db.rpc("email_delete_oauth_secret", { p_secret_id: secretId });
      }
      await db
        .from("email_connections")
        .update({ status: "REVOKED", disconnected_at: new Date().toISOString(), refresh_token_secret_id: null })
        .eq("id", connection.id)
        .eq("empresa_id", profile.empresa_id)
        .eq("user_id", profile.id);
      await recordEmailEvent(db, actorFromProfile(profile), {
        eventType: "email.connection.revoked",
        connectionId: connection.id,
        metadata: { provider: "GMAIL", providerEmail: (connection as { provider_email: string | null }).provider_email },
      });
    }
    return NextResponse.redirect(new URL("/configuracion?email=gmail_disconnected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/configuracion?email=gmail_error", request.url));
  }
}
