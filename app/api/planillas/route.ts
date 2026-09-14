import { NextRequest, NextResponse } from "next/server";
import { crearPlanilla } from "@/lib/planillas/service";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const modulo = (body as { modulo?: unknown } | null)?.modulo;
  const contexto = (body as { contexto?: unknown } | null)?.contexto;
  if (typeof modulo !== "string") {
    return NextResponse.json({ error: "modulo es requerido." }, { status: 400 });
  }

  try {
    const planilla = await crearPlanilla(modulo, contexto);
    return NextResponse.json(planilla, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo crear la planilla.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
