import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runClimateEvaluationBatch } from "@/lib/procurement/climate-evaluation-runner";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}

async function handleCron(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return NextResponse.json({ error: "Servidor no configurado: CRON_SECRET ausente (Fail-Closed)" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ") || authHeader.substring(7).trim() !== cronSecret) {
    return NextResponse.json({ error: "No autorizado: se requiere Authorization Bearer válido" }, { status: 401 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "date debe tener formato YYYY-MM-DD" }, { status: 400 });
    }
    const result = await runClimateEvaluationBatch(createAdminClient(), {
      date,
      projectId: params.get("project_id") ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    });
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...result });
  } catch (error) {
    console.error("[Cron Climate Evaluation] Error fatal:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
