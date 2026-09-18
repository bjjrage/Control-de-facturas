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
    return NextResponse.json({ provider: "GMAIL", connection }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar Gmail" }, { status: 503 });
  }
}
