import { requirePlan } from "@/lib/auth";
import {
  InvalidModelResponseError,
  ModelUnavailableError,
  WorkbookInterpreterConfigurationError,
  WorkbookInterpreterInputTooLargeError,
  WorkbookInterpreterRateLimitError,
  WorkbookInterpreterTimeoutError,
  interpretWorkbook,
} from "@/lib/workbook-interpretation/interpreter";
import { WorkbookInputError, parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { createWorkbookPreviewToken } from "@/lib/workbook-interpretation/preview-token";

export const runtime = "nodejs";
export const maxDuration = 60;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) return error("Seleccioná una planilla para analizar.", 400);
    const fileBytes = new Uint8Array(await uploaded.arrayBuffer());
    const workbook = parseWorkbook(fileBytes, uploaded.name);
    const result = await interpretWorkbook(workbook);
    const canonical = buildCanonicalImportCandidate(workbook, result);
    const previewToken = createWorkbookPreviewToken({ fileBytes, result, userId: profile.id, empresaId: profile.empresa_id });
    return Response.json({ result, canonical, previewToken, sheets: workbook.sheets.map((sheet) => sheet.sheetName) });
  } catch (cause) {
    if (cause instanceof WorkbookInputError) return error(cause.message, 400);
    if (cause instanceof WorkbookInterpreterInputTooLargeError) return error(cause.message, 413);
    if (cause instanceof WorkbookInterpreterTimeoutError) return error(cause.message, 504);
    if (cause instanceof WorkbookInterpreterRateLimitError) return error(cause.message, 429);
    if (cause instanceof WorkbookInterpreterConfigurationError) return error(cause.message, 503);
    if (cause instanceof ModelUnavailableError) return error(cause.message, 503);
    if (cause instanceof InvalidModelResponseError) return error(cause.message, 502);
    console.error("[workbook-interpretation] unexpected error", cause);
    return error("No se pudo analizar la planilla. Probá nuevamente.", 500);
  }
}
