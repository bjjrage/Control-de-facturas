import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { actorFromProfile } from "@/lib/agent/context";
import { recordEmailEvent } from "@/lib/email/domain-service";
import { revokeGoogleToken } from "@/lib/email/google-oauth";
import { assertSameOrigin } from "@/lib/security/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectResult(request: Request, result: string, status = 303) {
  const url = new URL("/configuracion", request.url);
  url.searchParams.set("email", result);
  return NextResponse.redirect(url, status);
}

async function updateDisconnectState(
  admin: ReturnType<typeof createAdminClient>,
  connectionId: string,
  empresaId: string,
  userId: string,
  status: "REVOKE_PENDING" | "DISCONNECT_FAILED"
) {
  await admin
    .from("email_connections")
    .update({ status })
    .eq("id", connectionId)
    .eq("empresa_id", empresaId)
    .eq("user_id", userId)
    .in("status", ["REVOKE_PENDING", "DISCONNECT_FAILED"]);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch {
    return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  }

  try {
    const profile = await requireProfile(["comercial", "admin"]);
    const admin = createAdminClient();
    const { data: connection, error: connectionError } = await admin
      .from("email_connections")
      .select("id, provider_email, refresh_token_secret_id, status")
      .eq("empresa_id", profile.empresa_id)
      .eq("user_id", profile.id)
      .eq("provider", "GMAIL")
      .in("status", ["CONNECTED", "REVOKE_PENDING", "DISCONNECT_FAILED"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (connectionError) return redirectResult(request, "gmail_disconnect_pending");
    if (!connection) return redirectResult(request, "gmail_disconnected");

    const locked = await admin
      .from("email_connections")
      .update({ status: "REVOKE_PENDING" })
      .eq("id", connection.id)
      .eq("empresa_id", profile.empresa_id)
      .eq("user_id", profile.id)
      .in("status", ["CONNECTED", "REVOKE_PENDING", "DISCONNECT_FAILED"])
      .select("id, provider_email, refresh_token_secret_id")
      .maybeSingle();
    if (locked.error || !locked.data) return redirectResult(request, "gmail_disconnect_pending");

    const lockedRow = locked.data as { provider_email: string | null; refresh_token_secret_id: string | null };
    const secretId = lockedRow.refresh_token_secret_id;
    const { data: activeAttempts, error: activeAttemptsError } = await admin
      .from("email_send_attempts")
      .select("id")
      .eq("empresa_id", profile.empresa_id)
      .eq("connection_id", connection.id)
      .in("status", ["CLAIMED", "DISPATCHING"]);
    if (activeAttemptsError) return redirectResult(request, "gmail_disconnect_pending");
    const hasInFlightAttempt = (activeAttempts ?? []).length > 0;
    if (!secretId) {
      const { data: revoked, error } = await admin
        .from("email_connections")
        .update({ status: "REVOKED", disconnected_at: new Date().toISOString(), refresh_token_secret_id: null })
        .eq("id", connection.id)
        .eq("empresa_id", profile.empresa_id)
        .eq("user_id", profile.id)
        .eq("status", "REVOKE_PENDING")
        .select("id")
        .maybeSingle();
      if (error || !revoked) return redirectResult(request, "gmail_disconnect_pending");
      await recordEmailEvent(admin, actorFromProfile(profile), {
        eventType: "email.connection.revoked",
        connectionId: connection.id,
        metadata: { provider: "GMAIL", providerEmail: lockedRow.provider_email },
      });
      return redirectResult(request, "gmail_disconnected");
    }

    const { data: refreshToken, error: secretError } = await admin.rpc("email_read_oauth_secret_for_revoke", {
      p_connection_id: connection.id,
      p_empresa_id: profile.empresa_id,
      p_user_id: profile.id,
    });
    if (secretError || typeof refreshToken !== "string" || !refreshToken) {
      await updateDisconnectState(admin, connection.id, profile.empresa_id, profile.id, "DISCONNECT_FAILED");
      return redirectResult(request, "gmail_disconnect_pending");
    }

    try {
      await revokeGoogleToken(refreshToken);
    } catch {
      await updateDisconnectState(admin, connection.id, profile.empresa_id, profile.id, "REVOKE_PENDING");
      return redirectResult(request, "gmail_disconnect_pending");
    }

    // The external revoke succeeded, but an already-claimed send may still be
    // using the credential/request. Keep the Vault secret until that attempt
    // reaches a terminal state; the UI remains explicitly pending.
    if (hasInFlightAttempt) return redirectResult(request, "gmail_disconnect_pending");

    const { error: deleteError } = await admin.rpc("email_delete_oauth_secret", {
      p_secret_id: secretId,
      p_empresa_id: profile.empresa_id,
      p_user_id: profile.id,
    });
    if (deleteError) {
      await updateDisconnectState(admin, connection.id, profile.empresa_id, profile.id, "DISCONNECT_FAILED");
      return redirectResult(request, "gmail_disconnect_pending");
    }

    const { data: revoked, error: revokeError } = await admin
      .from("email_connections")
      .update({ status: "REVOKED", disconnected_at: new Date().toISOString(), refresh_token_secret_id: null })
      .eq("id", connection.id)
      .eq("empresa_id", profile.empresa_id)
      .eq("user_id", profile.id)
      .eq("status", "REVOKE_PENDING")
      .select("id")
      .maybeSingle();
    if (revokeError || !revoked) return redirectResult(request, "gmail_disconnect_pending");

    await recordEmailEvent(admin, actorFromProfile(profile), {
      eventType: "email.connection.revoked",
      connectionId: connection.id,
      metadata: { provider: "GMAIL", providerEmail: lockedRow.provider_email },
    });
    return redirectResult(request, "gmail_disconnected");
  } catch {
    return redirectResult(request, "gmail_disconnect_pending");
  }
}
