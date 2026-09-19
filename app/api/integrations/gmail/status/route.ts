import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { actorFromProfile } from "@/lib/agent/context";
import { gmailEmailProvider } from "@/lib/email/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await requireProfile(["comercial", "admin"]);
    const db = await createClient();
    const connection = await gmailEmailProvider.getConnectionStatus({ db, actor: actorFromProfile(profile) });
    const connected = connection?.status === "CONNECTED";
    const serverConfigured = Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_GMAIL_REDIRECT_URI
    );

    return NextResponse.json(
      {
        connected,
        serverConfigured,
        providerEmail: connected ? connection?.providerEmail ?? null : null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar Gmail" }, { status: 503 });
  }
}
