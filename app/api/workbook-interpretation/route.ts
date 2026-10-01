import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { certificateWorkbookFingerprint, extractCertificateWorkbookData, matchCertificateRows, type CertificateBudgetItem } from "@/lib/certificates/workbook-import";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { reconcileImportPlan } from "@/lib/workbook-interpretation/import-plan";
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

export const runtime = "nodejs";
// The interpreter runs one model conversation (with read tools) capped at
// 270 s; this leaves room for parsing and the response.
export const maxDuration = 300;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) return error("Seleccioná una planilla para analizar.", 400);
    if (formData.get("target") === "project-certificate") {
      return await previewProjectCertificateImport(formData, uploaded, profile);
    }
    const requestStartedAt = performance.now();
    const parseStartedAt = performance.now();
    const workbook = parseWorkbook(new Uint8Array(await uploaded.arrayBuffer()), uploaded.name);
    const parseMs = Math.round(performance.now() - parseStartedAt);
    const result = await interpretWorkbook(workbook);
    const candidateStartedAt = performance.now();
    const candidate = buildCanonicalImportCandidate(workbook, result);
    console.info("workbook_interpretation_request_timing", {
      parse_ms: parseMs,
      candidate_ms: Math.round(performance.now() - candidateStartedAt),
      request_total_ms: Math.round(performance.now() - requestStartedAt),
    });
    return Response.json({ result, candidate });
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

async function previewProjectCertificateImport(
  formData: FormData,
  uploaded: File,
  profile: Awaited<ReturnType<typeof requirePlan>>,
) {
  const projectId = String(formData.get("project_id") ?? "");
  if (!projectId) return error("Seleccioná la obra existente para importar el certificado.", 400);
  if (!/\.xlsx$/i.test(uploaded.name)) return error("Por ahora el importador acepta únicamente archivos .xlsx.", 400);
  if (uploaded.size > 10 * 1024 * 1024) return error("El archivo supera el límite de 10 MB.", 413);

  const supabase = await createClient();
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (projectError || !project) return error("Obra no encontrada para la empresa activa.", 404);

  const [budgetResult, certificatesResult] = await Promise.all([
    supabase.from("budget_items")
      .select("id, project_id, code, description, unit, quantity, unit_price, sort_order")
      .eq("project_id", projectId)
      .order("sort_order"),
    supabase.from("project_certificates")
      .select("id, numero, status")
      .eq("project_id", projectId)
      .order("numero", { ascending: false }),
  ]);
  if (budgetResult.error || certificatesResult.error) return error("No se pudieron cargar el presupuesto y la secuencia de esta obra.", 500);

  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  const workbook = parseWorkbook(bytes, uploaded.name);
  const inferred = reconcileImportPlan(workbook, {
    workbookType: "CONSTRUCTION_PROJECT",
    overallConfidence: 1,
    blocks: [],
    unresolvedRegions: [],
    warnings: [],
  }, ["CERTIFICATE"]);
  const plan = { ...inferred.plan, warnings: [...inferred.plan.warnings, ...inferred.warnings] };
  const certificate = extractCertificateWorkbookData(workbook, plan);
  const projectBudgetItems = (budgetResult.data ?? []) as CertificateBudgetItem[];
  const rows = matchCertificateRows(certificate.rows, projectBudgetItems, projectId);

  const priorCertificates = (certificatesResult.data ?? []).filter((item) =>
    ["ELABORADO", "VERIFICADO", "APROBADO", "FACTURADO"].includes(item.status)
  );
  const previousQuantityByBudgetItem: Record<string, number> = {};
  if (priorCertificates.length) {
    const { data: priorItems, error: priorItemsError } = await supabase
      .from("project_certificate_items")
      .select("budget_item_id, qty_presente")
      .in("certificate_id", priorCertificates.map((item) => item.id));
    if (priorItemsError) return error("No se pudo verificar el acumulado anterior de esta obra.", 500);
    for (const item of priorItems ?? []) {
      if (!item.budget_item_id) continue;
      previousQuantityByBudgetItem[item.budget_item_id] = (previousQuantityByBudgetItem[item.budget_item_id] ?? 0) + Number(item.qty_presente ?? 0);
    }
  }

  const latest = certificatesResult.data?.[0] ?? null;
  const nextNumber = (latest?.numero ?? 0) + 1;
  const fingerprint = certificateWorkbookFingerprint(bytes);
  const { data: existingImport, error: existingError } = await supabase
    .from("project_certificates")
    .select("id, numero")
    .eq("project_id", projectId)
    .eq("import_fingerprint", fingerprint)
    .maybeSingle();
  if (existingError) return error("No se pudo verificar si este archivo ya fue importado.", 500);

  const warnings = [...certificate.warnings];
  if (latest && certificate.number !== nextNumber) {
    warnings.push(`El certificado N°${certificate.number} se importa sin que los certificados anteriores estén registrados en el ERP (último registrado: #${latest.numero}).`);
  } else if (!latest && certificate.number > 1) {
    warnings.push(`El certificado N°${certificate.number} fue importado sin que los certificados 1–${certificate.number - 1} estén registrados en el ERP.`);
  }
  if (!projectBudgetItems.length) {
    warnings.push("La obra no tiene partidas de presupuesto cargadas; el certificado se importará con sus partidas contractuales autónomas.");
  }

  return Response.json({
    plan,
    certificate: {
      number: certificate.number,
      periodStart: certificate.periodStart,
      periodEnd: certificate.periodEnd,
      sheet: certificate.sheet,
      planNeedsReview: certificate.planNeedsReview,
      warnings,
    },
    rows,
    budgetItems: projectBudgetItems,
    previousQuantityByBudgetItem,
    nextNumber,
    predecessorStatus: latest?.status ?? null,
    sequenceValid: true,
    existingImport: existingImport ? { id: existingImport.id, number: existingImport.numero } : null,
  });
}
