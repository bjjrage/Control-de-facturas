/**
 * Worker de parseo de facturas. Corre siempre prendido en Railway (start:
 * `npx tsx worker/index.ts`). Hace polling de la tabla `invoice_jobs` cada
 * POLL_MS y procesa un job por ciclo:
 *
 *   descargar de Storage -> leer con GPT-4o / pdf-parse -> identificar proveedor
 *   por RUC -> crear factura + adjunto + auto-conciliar.
 *
 * Los que salen incompletos quedan en `needs_review` para la cola de revisión
 * manual del panel. Nunca tira: cualquier error deja el job en `failed` (o lo
 * reencola si attempts < MAX_ATTEMPTS) y sigue con el próximo.
 *
 * La lógica de extracción / lookup / match se reutiliza de lib/ tal cual — esos
 * archivos no dependen de Next.
 */
import { config } from "dotenv";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { extractInvoiceFieldsFromFile } from "../lib/invoice-extraction";
import { validateInvoiceArithmetic } from "../lib/invoice-arithmetic";
import { compareInvoiceQuantitySum, isValidInvoiceQuantity, type PhysicalQuantity } from "../lib/invoice-item-reconcile";
import { insertValidatedItemMatches } from "../lib/invoice-items";
import { findProviderByTaxId } from "../lib/provider-lookup";
import { autoMatchInvoice } from "../lib/invoice-auto-match";
import { matchInvoiceItemsToOrderItems } from "../lib/invoice-item-match";
import { logAudit } from "../lib/audit";
import { sanitizeFileName } from "../lib/storage";
import { finishInvoiceJobLease, invoiceJobCreationDisposition, invoiceJobMatchingOutcome } from "../lib/invoice-job-worker";

// Local: toma las credenciales de .env.local. En Railway vienen de las env vars
// del servicio y esto es no-op.
config({ path: ".env.local" });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2500);
const MAX_ATTEMPTS = 3;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Falta OPENAI_API_KEY");
  process.exit(1);
}

const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type InvoiceJob = {
  id: string;
  empresa_id: string;
  created_by: string;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  batch_date: string;
  attempts: number;
  invoice_id?: string | null;
};

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function isOwnedInboxObject(job: InvoiceJob) {
  const prefix = `${job.empresa_id}/inbox/`;
  const tail = job.storage_path.slice(prefix.length);
  return job.storage_bucket === "invoice-files" && job.storage_path.startsWith(prefix)
    && tail.length > 0 && !tail.includes("..") && !tail.includes("\\") && !tail.includes("//");
}

async function finish(jobId: string, expectedAttempts: number, expectedInvoiceId: string | null, patch: Record<string, unknown>) {
  const result = await finishInvoiceJobLease(db, { id: jobId, attempts: expectedAttempts, invoice_id: expectedInvoiceId }, patch);
  if (result.error) throw new Error(`No se pudo guardar el estado del job ${jobId}: ${result.error}`);
  if (!result.updated) throw new Error(`El job ${jobId} perdió su lease o cambió de factura; no se sobrescribió el estado más reciente.`);
}

async function processJob(job: InvoiceJob) {
  log(`job ${job.id} — ${job.file_name} (intento ${job.attempts})`);

  if (job.invoice_id) {
    return finish(job.id, job.attempts, job.invoice_id ?? null, {
      status: "needs_review",
      outcome: "needs_manual",
      error: "El job ya referencia una factura creada; no se volverá a procesar como una factura nueva.",
      message: "Este job ya creó una factura. Revisá la factura existente antes de continuar.",
    });
  }
  if (!isOwnedInboxObject(job)) {
    return finish(job.id, job.attempts, null, {
      status: "needs_review",
      outcome: "needs_manual",
      error: "La ruta del archivo no pertenece a la bandeja de esta empresa.",
      message: "El archivo no se procesó porque su ubicación no pertenece a la bandeja de esta empresa.",
    });
  }

  const { data: blob, error: dlError } = await db.storage
    .from(job.storage_bucket)
    .download(job.storage_path);
  if (dlError || !blob) {
    return finish(job.id, job.attempts, job.invoice_id ?? null, { status: "failed", error: `No se pudo bajar el archivo: ${dlError?.message ?? "?"}` });
  }
  const bytes = Buffer.from(await blob.arrayBuffer());

  const { data: parsed, error: extractError } = await extractInvoiceFieldsFromFile(bytes, job.mime_type);
  if (extractError || !parsed) {
    if (job.attempts < MAX_ATTEMPTS) {
      return finish(job.id, job.attempts, job.invoice_id ?? null, { status: "queued", error: extractError ?? "Lectura fallida" });
    }
    return finish(job.id, job.attempts, job.invoice_id ?? null, {
      status: "needs_review",
      outcome: "needs_manual",
      error: extractError ?? "No se pudo leer la factura",
      message: extractError ?? "No se pudo leer la factura — cargala a mano.",
    });
  }

  const provider = await findProviderByTaxId(db, parsed.provider_tax_id, job.empresa_id);
  const providerName = provider?.name ?? parsed.provider_name;

  if (!provider || !parsed.invoice_number || !parsed.total || parsed.total <= 0) {
    const reason = !provider
      ? `Proveedor no identificado (RUC ${parsed.provider_tax_id ?? "no detectado"}${parsed.provider_name ? `, "${parsed.provider_name}"` : ""}).`
      : !parsed.invoice_number
        ? "Número de factura no legible."
        : "Monto no legible.";
    return finish(job.id, job.attempts, job.invoice_id ?? null, {
      status: "needs_review",
      outcome: "needs_manual",
      extracted: parsed,
      provider_id: provider?.id ?? null,
      message: `${reason} Completala en revisión.`,
    });
  }

  // Validación aritmética determinística: una extracción inconsistente nunca
  // avanza silenciosamente; queda en revisión con el motivo explícito.
  const arithmetic = validateInvoiceArithmetic(parsed);
  if (arithmetic.status !== "VALIDA") {
    return finish(job.id, job.attempts, job.invoice_id ?? null, {
      status: "needs_review",
      outcome: "needs_manual",
      extracted: { ...parsed, validation: arithmetic },
      provider_id: provider.id,
      message: `Revisión aritmética: ${arithmetic.issues[0] ?? "datos inconsistentes."}`,
    });
  }

  // Adjunto: copiar el archivo del inbox a su ubicación definitiva por proveedor.
  const finalPath = `${provider.id}/${randomUUID()}-${sanitizeFileName(job.file_name)}`;
  const { error: copyError } = await db.storage.from("invoice-files").copy(job.storage_path, finalPath);
  if (copyError) {
    return finish(job.id, job.attempts, null, {
      status: "needs_review", outcome: "needs_manual", extracted: parsed, provider_id: provider.id,
      error: copyError.message, message: "No se pudo preparar el archivo adjunto; el original se conservó para revisión.",
    });
  }

  const { data: attachment, error: attachmentError } = await db
    .from("attachments")
    .insert({
      empresa_id: job.empresa_id,
      bucket: "invoice-files",
      path: finalPath,
      file_name: job.file_name,
      mime_type: job.mime_type,
      size_bytes: bytes.length,
      uploaded_by: job.created_by,
    })
    .select("id")
    .single();
  if (attachmentError || !attachment) {
    let cleanupWarning: string | null = null;
    if (attachmentError?.code && /^[0-9A-Z]{5}$/.test(attachmentError.code)) {
      try {
        const { error: cleanupError } = await db.storage.from("invoice-files").remove([finalPath]);
        cleanupWarning = cleanupError?.message ?? null;
      } catch (error) {
        cleanupWarning = (error as Error).message;
      }
    }
    return finish(job.id, job.attempts, null, {
      status: "needs_review", outcome: "needs_manual", extracted: parsed, provider_id: provider.id,
      error: attachmentError?.message ?? "No se registró el adjunto.",
      message: cleanupWarning
        ? "No se pudo registrar el archivo adjunto; el original se conservó para revisión y la copia requiere limpieza."
        : !attachmentError || !attachmentError.code
        ? "No se pudo confirmar el registro del archivo adjunto; no se borró la copia por seguridad y el job requiere revisión."
        : "No se pudo registrar el archivo adjunto; el original se conservó para revisión.",
    });
  }

  const { data: createResult, error: invoiceError } = await db.rpc("create_invoice_from_job", {
    p_empresa_id: job.empresa_id,
    p_job_id: job.id,
    p_expected_attempts: job.attempts,
    p_invoice: {
      provider_id: provider.id,
      invoice_number: parsed.invoice_number,
      invoice_date: parsed.invoice_date ?? job.batch_date,
      currency: "PYG",
      subtotal: parsed.subtotal,
      vat: parsed.vat,
      total: parsed.total,
      timbrado: parsed.timbrado,
      attachment_id: attachment?.id ?? null,
    },
  });
  const creation = invoiceJobCreationDisposition(createResult, invoiceError);
  if (creation.kind === "existing") {
    job.invoice_id = creation.invoiceId;
    return finish(job.id, job.attempts, job.invoice_id, {
      status: "needs_review",
      outcome: "needs_manual",
      invoice_id: job.invoice_id,
      extracted: parsed,
      provider_id: provider.id,
      message: "Este job ya creó una factura. Se conservó la referencia existente y no se duplicaron líneas ni conciliaciones.",
    });
  }
  if (creation.kind === "failed") {
    return finish(job.id, job.attempts, job.invoice_id ?? null, {
      status: "needs_review",
      outcome: creation.duplicateNumber ? "duplicate" : "error",
      extracted: parsed,
      provider_id: provider.id,
      error: creation.error,
      message: creation.duplicateNumber ? `Ya existe una factura con ese número para ${providerName}.` : (creation.error ?? "No se pudo crear la factura."),
    });
  }

  // The RPC inserts the invoice and checkpoints invoice_jobs.invoice_id in one transaction.
  const invoice = { id: creation.invoiceId };
  job.invoice_id = invoice.id;

  // Guardar líneas de detalle extraídas por el AI.
  const invoiceItemIds: { id: string; idx: number }[] = [];
  let itemSaveError: string | null = null;
  const indexedItems = (parsed.items ?? [])
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => Boolean(item.description?.trim()));
  if (indexedItems.some(({ item }) => item.quantity !== null && !isValidInvoiceQuantity(item.quantity))) {
    itemSaveError = "Una cantidad extraída no conserva la precisión admitida; las líneas no se guardaron y requieren revisión.";
  } else if (indexedItems.length > 0) {
    const { data: insertedItems, error: itemError } = await db
      .from("invoice_items")
      .insert(indexedItems.map(({ item, idx }) => ({
          invoice_id: invoice.id,
          empresa_id: job.empresa_id,
          product_description: item.description.trim(),
          quantity: item.quantity as unknown as number | null,
          unit: item.unit,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
          sort_order: idx,
        })))
      .select("id, sort_order");
    if (itemError || !insertedItems || insertedItems.length !== indexedItems.length) {
      itemSaveError = itemError?.message ?? "La base de datos no devolvió todas las líneas creadas.";
    } else {
      for (const inserted of insertedItems) {
        invoiceItemIds.push({ id: inserted.id as string, idx: Number(inserted.sort_order) });
      }
    }
  }

  if (itemSaveError) {
    await logAudit(db, {
      action: "invoice.lines_save_failed",
      invoiceId: invoice.id,
      detail: { error: itemSaveError, source: "bulk_worker", saved_lines: invoiceItemIds.length },
    });
  }

  // A partially or wholly failed line batch must remain review-only: even a
  // header-level auto-match could make an incomplete invoice look reconciled.
  const matchedOrderId = itemSaveError ? null : await autoMatchInvoice(db, {
    invoiceId: invoice.id,
    providerId: provider.id,
    total: parsed.total,
    empresaId: job.empresa_id,
    orderReference: parsed.order_reference,
    productDescription: parsed.product_description,
  });

  // Si se matcheó la OC y hay ítems en ambos lados, hacer matching semántico de
  // líneas. Las propuestas del motor semántico pasan por el mismo control
  // validado que la vía del diálogo (vínculo de cabecera, tope documentado,
  // remanente, duplicados): lo que excede queda pendiente, nunca se contabiliza.
  let itemMatchError: string | null = null;
  let itemMatchPending = 0;
  let itemMatchSkipped = 0;
  if (!itemSaveError && matchedOrderId && invoiceItemIds.length > 0) {
    const { data: orderItems, error: orderItemsError } = await db
      .from("authorized_order_items")
      .select("id, product, quantity::text, unit, quantity_invoiced::text")
      .eq("order_id", matchedOrderId)
      .order("sort_order");

    if (orderItemsError) {
      itemMatchError = orderItemsError.message;
    } else if (orderItems && orderItems.length > 0) {
      const invoiceItemsForMatch = invoiceItemIds.map(({ id, idx }) => ({
        id,
        description: parsed.items[idx].description,
        quantity: parsed.items[idx].quantity,
        unit: parsed.items[idx].unit,
      }));

      const itemMatches = await matchInvoiceItemsToOrderItems(
        orderItems.map((o) => ({
          id: o.id as string,
          product: o.product as string,
          quantity: o.quantity as string,
          unit: o.unit as string,
          quantity_invoiced: o.quantity_invoiced as string,
        })),
        invoiceItemsForMatch
      );

      const proposals = itemMatches.map((m) => ({
        invoiceItemId: m.invoice_item_id,
        orderItemId: m.order_item_id,
        quantityMatched: m.quantity_matched,
      }));
      const validated = await insertValidatedItemMatches(db, {
        empresaId: job.empresa_id,
        invoiceId: invoice.id as string,
        expectedOrderId: matchedOrderId,
        proposals,
      });
      itemMatchSkipped = validated.skippedNoLink + validated.skippedOverDocumented
        + validated.skippedOverRemaining + validated.skippedDuplicate + validated.skippedMismatch;
      if (validated.error) {
        itemMatchError = validated.error;
        await logAudit(db, {
          action: "invoice.item_match_failed",
          invoiceId: invoice.id as string,
          detail: { error: validated.error, source: "bulk_worker" },
        });
      }
      if (!validated.error) {
        const { data: persisted, error: persistedError } = await db.from("invoice_item_matches")
          .select("invoice_item_id, quantity_matched::text")
          .eq("empresa_id", job.empresa_id)
          .in("invoice_item_id", invoiceItemIds.map(({ id }) => id));
        if (persistedError) itemMatchError = `No se pudo verificar el resultado de conciliación: ${persistedError.message}`;
        else {
          const matchedByLine = new Map<string, PhysicalQuantity[]>();
          for (const match of persisted ?? []) {
            const lineId = match.invoice_item_id as string;
            const quantities = matchedByLine.get(lineId) ?? [];
            quantities.push(match.quantity_matched as string);
            matchedByLine.set(lineId, quantities);
          }
          for (const { id, idx } of invoiceItemIds) {
            const documented = parsed.items[idx].quantity;
            const comparison = compareInvoiceQuantitySum(matchedByLine.get(id) ?? [], documented);
            if (!isValidInvoiceQuantity(documented) || comparison === null || comparison === -1) itemMatchPending++;
          }
        }
      }
    } else {
      itemMatchPending = invoiceItemIds.length;
    }
  }

  if (itemMatchPending > 0 || itemMatchSkipped > 0) {
    await logAudit(db, {
      action: "invoice.item_match_pending",
      invoiceId: invoice.id as string,
      detail: { pending_lines: itemMatchPending, skipped_proposals: itemMatchSkipped, source: "bulk_worker" },
    });
  }

  const matchingOutcome = invoiceJobMatchingOutcome({
    lineSaveError: itemSaveError,
    matchError: itemMatchError,
    pendingLines: itemMatchPending,
    skippedProposals: itemMatchSkipped,
    matchedOrderId,
    lineCount: invoiceItemIds.length,
  });
  return finish(job.id, job.attempts, job.invoice_id ?? null, {
    status: matchingOutcome.status,
    outcome: matchingOutcome.outcome,
    extracted: parsed,
    provider_id: provider.id,
    invoice_id: invoice.id,
    error: itemSaveError ?? itemMatchError,
    message: matchingOutcome.message,
  });
}

async function main() {
  log(`worker arrancado — polling cada ${POLL_MS}ms`);
  while (!stopping) {
    // Reencolar jobs huérfanos antes de reclamar uno nuevo.
    // Si el worker murió a mitad de un job, locked_at queda viejo. Los jobs sin
    // factura vuelven a cola/fallo; los que ya guardaron invoice_id pasan a
    // needs_review para que nadie genere otra factura al reintentarlos.
    try {
      const { data: stale, error: staleErr } = await db.rpc("requeue_stale_invoice_jobs", {
        timeout_minutes: 30,  // locked_at no se actualiza durante el procesamiento → este es el tiempo máximo de un job
        max_attempts: MAX_ATTEMPTS,
      });
      if (staleErr) log("requeue_stale error:", staleErr.message);
      else if (stale && stale > 0) log(`requeue_stale: ${stale} job(s) recuperados para reintento o revisión`);
    } catch (e) {
      log("requeue_stale throw:", (e as Error).message);
    }

    let job: InvoiceJob | null = null;
    try {
      const { data, error } = await db.rpc("claim_invoice_job");
      if (error) { log("claim error:", error.message); }
      else job = (data && data.id ? data : null) as InvoiceJob | null;
    } catch (e) {
      log("claim throw:", (e as Error).message);
    }

    if (!job) { await sleep(POLL_MS); continue; }

    try {
      await processJob(job);
    } catch (e) {
      log(`job ${job.id} throw:`, (e as Error).message);
      try {
        await finish(job.id, job.attempts, job.invoice_id ?? null, job.invoice_id
          ? {
              status: "needs_review",
              outcome: "needs_manual",
              invoice_id: job.invoice_id,
              error: (e as Error).message ?? "error inesperado",
              message: "La factura ya se creó, pero el procesamiento se interrumpió. Revisá la factura existente.",
            }
          : { status: "failed", error: (e as Error).message ?? "error inesperado" });
      } catch (finishError) {
        log(`job ${job.id} finish error:`, (finishError as Error).message);
      }
    }
  }
  log("worker detenido");
  process.exit(0);
}

main();
