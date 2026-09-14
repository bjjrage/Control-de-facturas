import { NextRequest, NextResponse } from "next/server";
import { actualizarSnapshot, obtenerPlanilla, PlanillaNotFoundError } from "@/lib/planillas/service";
import type { PlanillaRowMeta } from "@/lib/planillas/types";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const planilla = await obtenerPlanilla(id);
    return NextResponse.json(planilla);
  } catch (e) {
    if (e instanceof PlanillaNotFoundError) {
      // Mismo status exista o no la planilla, sea de otro tenant o no —
      // nunca confirmarle a un usuario que un UUID ajeno existe.
      return NextResponse.json({ error: "Planilla no encontrada." }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : "Error al obtener la planilla.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const rows = (body as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "rows debe ser un array." }, { status: 400 });
  }

  try {
    const result = await actualizarSnapshot(id, rows as PlanillaRowMeta[]);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PlanillaNotFoundError) {
      return NextResponse.json({ error: "Planilla no encontrada." }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : "No se pudo guardar el borrador.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
