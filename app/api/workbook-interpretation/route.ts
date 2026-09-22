import { requirePlan } from "@/lib/auth";
import {
  InvalidModelResponseError,
  ModelUnavailableError,
  WorkbookInterpreterInputTooLargeError,
  interpretWorkbook,
} from "@/lib/workbook-interpretation/interpreter";
import { WorkbookInputError, parseWorkbook } from "@/lib/workbook-interpretation/parser";

export const runtime = "nodejs";
export const maxDuration = 60;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  await requirePlan("pro", ["administracion", "admin"]);
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) return error("Seleccioná una planilla para analizar.", 400);
    const workbook = parseWorkbook(new Uint8Array(await uploaded.arrayBuffer()), uploaded.name);
    const result = await interpretWorkbook(workbook);
    return Response.json({ result });
  } catch (cause) {
    if (cause instanceof WorkbookInputError) return error(cause.message, 400);
    if (cause instanceof WorkbookInterpreterInputTooLargeError) return error(cause.message, 413);
    if (cause instanceof ModelUnavailableError) return error(cause.message, 503);
    if (cause instanceof InvalidModelResponseError) return error(cause.message, 502);
    console.error("[workbook-interpretation] unexpected error", cause);
    return error("No se pudo analizar la planilla. Probá nuevamente.", 500);
  }
}
