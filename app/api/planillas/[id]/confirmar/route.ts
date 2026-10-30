import { NextRequest, NextResponse } from "next/server";
import { confirmarPlanilla, PlanillaNotFoundError } from "@/lib/planillas/service";
import { PlanillaConcurrencyError, PlanillaUncertainError } from "@/lib/planillas/types";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => null);
    if (typeof body?.expectedVersion !== "string" || !Number.isFinite(Date.parse(body.expectedVersion))) {
      return NextResponse.json({ error: "Se requiere la revisión guardada para confirmar." }, { status: 400 });
    }
    const { alreadyConfirmed, result } = await confirmarPlanilla(id, body.expectedVersion);
    return NextResponse.json({ alreadyConfirmed, result });
  } catch (e) {
    if (e instanceof PlanillaUncertainError) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    if (e instanceof PlanillaNotFoundError) {
      return NextResponse.json({ error: "Planilla no encontrada." }, { status: 404 });
    }
    if (e instanceof PlanillaConcurrencyError) {
      return NextResponse.json({ error: e.message, code: "CONFLICT" }, { status: 409 });
    }
    const message = e instanceof Error ? e.message : "No se pudo confirmar la planilla.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
