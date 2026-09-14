import { NextRequest, NextResponse } from "next/server";
import { confirmarPlanilla, PlanillaNotFoundError } from "@/lib/planillas/service";
import { PlanillaConcurrencyError } from "@/lib/planillas/types";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { alreadyConfirmed, result } = await confirmarPlanilla(id);
    return NextResponse.json({ alreadyConfirmed, result });
  } catch (e) {
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
