import { requirePlan } from "@/lib/auth";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { WorkbookInputError } from "@/lib/workbook-interpretation/parser";
import {
  InvalidModelResponseError,
  ModelUnavailableError,
  WorkbookInterpreterConfigurationError,
  WorkbookInterpreterRateLimitError,
  WorkbookInterpreterTimeoutError,
} from "@/lib/workbook-interpretation/interpreter";
import { analyzeApuWorkbook } from "@/lib/apu-import/analyze";

export const runtime = "nodejs";
// Varias llamadas a Luna en paralelo; queda debajo del límite de la función.
export const maxDuration = 300;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Lee la planilla completa y devuelve la vista previa de recetas. No guarda nada. */
export async function POST(request: Request) {
  await requirePlan("pro", ["administracion", "admin"]);
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) return error("Seleccioná una planilla para analizar.", 400);
    const workbook = parseWorkbook(new Uint8Array(await uploaded.arrayBuffer()), uploaded.name);
    const preview = await analyzeApuWorkbook(workbook);
    return Response.json({ preview });
  } catch (cause) {
    if (cause instanceof WorkbookInputError) return error(cause.message, 400);
    if (cause instanceof WorkbookInterpreterTimeoutError) return error(cause.message, 504);
    if (cause instanceof WorkbookInterpreterRateLimitError) return error(cause.message, 429);
    if (cause instanceof WorkbookInterpreterConfigurationError || cause instanceof ModelUnavailableError) return error(cause.message, 503);
    if (cause instanceof InvalidModelResponseError) return error(cause.message, 502);
    console.error("[apu-import] unexpected error", cause);
    return error("No se pudo analizar la planilla. Probá nuevamente.", 500);
  }
}
