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
  // P0 CRON SECURITY: Fail-closed estricto.
  // Si CRON_SECRET no está configurado, PROHIBIR operaciones administrativas.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Servidor no configurado: CRON_SECRET ausente (Fail-Closed)" },
      { status: 500 }
    );
  }

  // Autorización exclusiva por Bearer token (no se admiten query parameters por seguridad)
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: "No autorizado: se requiere encabezado Authorization Bearer" },
      { status: 401 }
    );
  }

  const token = authHeader.substring(7).trim();
  if (token !== cronSecret) {
    return NextResponse.json(
      { error: "No autorizado: token inválido" },
      { status: 401 }
    );
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
