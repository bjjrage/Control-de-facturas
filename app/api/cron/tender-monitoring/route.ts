import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTenderMonitoringBatch } from "@/lib/procurement/tender-monitoring-runner";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  // Verificación de autenticación para crons (Vercel Cron / Scheduler externo)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const customHeader = request.headers.get("x-cron-secret");
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get("key");

    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
    const isAuthorized = token === cronSecret || customHeader === cronSecret || queryKey === cronSecret;

    if (!isAuthorized) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
  }

  try {
    const supabase = createAdminClient();
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : 25;
    const empresaId = searchParams.get("empresa_id") || undefined;
    const dryRun = searchParams.get("dry_run") === "true";

    const result = await runTenderMonitoringBatch(supabase, { limit, empresaId, dryRun });

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    });
  } catch (error: any) {
    console.error("[Cron Tender Monitoring] Error fatal:", error);
    return NextResponse.json(
      { ok: false, error: error.message || String(error) },
      { status: 500 }
    );
  }
}
