"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { autoMatchInvoice, invoiceOrderContextMatches } from "@/lib/invoice-auto-match";
import { validateInvoiceArithmetic } from "@/lib/invoice-arithmetic";
import { calculateInvoiceVat } from "@/lib/invoice-vat";
import { INVOICE_QUANTITY_ERROR, isValidInvoiceQuantity } from "@/lib/invoice-item-reconcile";
import type { ExtractedInvoiceItem } from "@/lib/invoice-extraction";
import { applyDeterministicItemMatches, insertInvoiceItems, parseInvoiceLinesInput } from "@/lib/invoice-items";
import { persistInvoiceIdentity, requireInvoiceIdentity } from "@/lib/invoice-identity";
import { verifyInvoiceExtractionProof, invoiceIssuerMatches } from "@/lib/invoice-extraction-proof";
import { revalidatePath } from "next/cache";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

type CreateInvoiceResult =
  | { error: string; id?: undefined; autoMatched?: undefined; warning?: undefined; arithmeticIssues?: string[]; invoiceId?: string }
  | { error: null; id: string; autoMatched: boolean; warning?: string };

/**
 * Reintenta la conciliación automática sobre todas las facturas pendientes de
 * vincular. Útil después de autorizar órdenes nuevas, o de corregir montos.
 */
export async function reconcilePendingInvoices() {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: pending } = await supabase
    .from("invoices")
    .select("id, provider_id, total")
    .eq("status", "PENDIENTE");

  let matched = 0;
  for (const inv of pending ?? []) {
    const orderId = await autoMatchInvoice(supabase, {
      invoiceId: inv.id,
      providerId: inv.provider_id,
      total: inv.total,
      empresaId,
    });
    if (orderId) matched++;
  }

  revalidatePath("/invoices");
  return { matched, total: (pending ?? []).length };
}

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function num(formData: FormData, key: string) {
  const v = formData.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function createInvoice(formData: FormData): Promise<CreateInvoiceResult> {
  const profile = await requireProfile(["administracion", "admin"]);

  const vatRate = str(formData, "vat_rate");
  if (vatRate && vatRate !== "document") {
    const amounts = calculateInvoiceVat(
      num(formData, "invoice_amount") ?? NaN,
      Number(vatRate),
      formData.get("vat_included") === "on",
      str(formData, "currency") ?? "PYG",
    );
    if (!amounts) return { error: "Ingresá un importe positivo y elegí IVA de 5%, 10% o exento." };
    formData.set("subtotal", String(amounts.subtotal));
    formData.set("vat", String(amounts.vat));
    formData.set("total", String(amounts.total));
  }

  const providerId = str(formData, "provider_id");
  const invoiceNumber = str(formData, "invoice_number");
  const invoiceDate = str(formData, "invoice_date");
  const dueDate = str(formData, "due_date");
  const currency = str(formData, "currency");
  const exchangeRate = num(formData, "exchange_rate");
  const total = num(formData, "total");
  const file = formData.get("file") as File | null;
  const scannerSessionId = str(formData, "scanner_session_id");

  if (!providerId || !invoiceNumber || !invoiceDate || !currency) {
    return { error: "Completá proveedor, número, fecha y moneda." };
  }
  if (total === null || total <= 0) return { error: "El total debe ser mayor a cero." };

  // R3-04: validación aritmética sobre los valores FINALES que se intentan
  // guardar (nunca se confía en un estado enviado por el cliente: se recalcula
  // en el servidor). Si hay discrepancias verificables, la creación exige la
  // confirmación explícita de un humano autorizado (checkbox del diálogo), que
  // queda auditada. La carga manual legítima sigue funcionando: con valores
  // consistentes no se pide nada extra.
  const dialogLines = parseInvoiceLinesInput(formData.get("items_json"));
  if (dialogLines.some((line) => line.quantity !== null && !isValidInvoiceQuantity(line.quantity))) {
    return { error: INVOICE_QUANTITY_ERROR };
  }
  const arithmetic = validateInvoiceArithmetic({
    provider_name: null,
    provider_tax_id: null,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    subtotal: num(formData, "subtotal"),
    vat: num(formData, "vat"),
    total,
    timbrado: str(formData, "timbrado"),
    order_reference: str(formData, "order_reference"),
    product_description: str(formData, "product_description"),
    items: dialogLines.map((l): ExtractedInvoiceItem => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      subtotal: l.subtotal,
    })),
  });
  if (arithmetic.status !== "VALIDA" && formData.get("arithmetic_confirmed") !== "on") {
    return {
      error: `Revisión aritmética: ${arithmetic.issues[0] ?? "datos inconsistentes."} Corregí los importes o confirmá explícitamente que los verificaste contra el documento.`,
      arithmeticIssues: arithmetic.issues,
    };
  }

  const admin = createAdminClient();
  const empresaId = profile.empresa_id;
  const { data: provider, error: providerError } = await admin.from("providers")
    .select("id, tax_id").eq("id", providerId).eq("empresa_id", empresaId).maybeSingle();
  if (providerError || !provider) return { error: "Proveedor no disponible para esta empresa." };

  const linkOrderId = str(formData, "link_order_id");
  if (linkOrderId) {
    const { data: order, error: orderError } = await admin.from("authorized_orders")
      .select("provider_id, currency, code, product").eq("id", linkOrderId).eq("empresa_id", empresaId).maybeSingle();
    if (orderError || !order || order.provider_id !== providerId || order.currency !== currency) {
      return { error: "El proveedor y la moneda deben coincidir con la OC de esta empresa." };
    }
  }
  let verifiedExtraction: ReturnType<typeof verifyInvoiceExtractionProof> = null;
  if (!scannerSessionId && file && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "El archivo no puede superar los 20MB." };
    verifiedExtraction = verifyInvoiceExtractionProof(str(formData, "extraction_proof"), {
      empresaId, actorId: profile.id, bytes: Buffer.from(await file.arrayBuffer()),
    });
    if (!verifiedExtraction) return { error: "Volvé a leer el documento: la lectura falta, venció o corresponde a otro archivo." };
    if (!invoiceIssuerMatches(verifiedExtraction.fields.provider_tax_id, provider.tax_id)) {
      return { error: "El RUC del emisor no coincide con el proveedor elegido. Identificá al emisor antes de guardar." };
    }
  }

  if (verifiedExtraction && (verifiedExtraction.fields.invoice_number !== invoiceNumber ||
    verifiedExtraction.fields.invoice_date !== invoiceDate || verifiedExtraction.fields.total !== total ||
    (verifiedExtraction.fields.currency && verifiedExtraction.fields.currency !== currency))) {
    return { error: "Número, fecha y total deben corresponder a la lectura del original. Volvé a leerlo antes de guardar cambios documentales." };
  }
  if (linkOrderId && verifiedExtraction) {
    const { data: order } = await admin.from("authorized_orders").select("code, product")
      .eq("id", linkOrderId).eq("empresa_id", empresaId).maybeSingle();
    const descriptions = verifiedExtraction.fields.items.map(item => item.description);
    if (!descriptions.length && verifiedExtraction.fields.product_description) descriptions.push(verifiedExtraction.fields.product_description);
    if (!order || !invoiceOrderContextMatches({ orderCode: order.code, orderProduct: order.product,
      orderReference: verifiedExtraction.fields.order_reference, descriptions })) {
      return { error: "El producto o la referencia del documento no coincide con la OC elegida. Revisá la imputación." };
    }
  }

  // Reject ordinary retries before creating a new Storage object. The unique
  // database constraint still protects concurrent submissions below.
  const { data: duplicate, error: duplicateError } = await admin.from("invoices")
    .select("id").eq("empresa_id", empresaId).eq("provider_id", providerId)
    .eq("invoice_number", invoiceNumber).maybeSingle();
  if (duplicateError) return { error: "No se pudo comprobar si la factura ya existe. Intentá nuevamente." };
  if (duplicate) return { error: "Ya existe una factura con ese número para este proveedor." };

  let attachmentId: string | null = null;
  let newlyCreatedScannerAttachmentId: string | null = null;
  let newlyUploadedManualPath: string | null = null;
  async function cleanupFailedManualUpload() {
    // Only this request's new manual upload is temporary. Never remove an
    // existing invoice original or a scanner-session evidence object.
    if (!newlyUploadedManualPath) return;
    if (attachmentId) {
      const result = await admin.from("attachments").delete()
        .eq("id", attachmentId).eq("empresa_id", empresaId)
        .eq("bucket", "invoice-files").eq("path", newlyUploadedManualPath);
      if (result.error) {
        console.error("Failed to clean temporary invoice attachment", result.error.code);
        return;
      }
    }
    const result = await admin.storage.from("invoice-files").remove([newlyUploadedManualPath]);
    if (result.error) console.error("Failed to clean temporary invoice upload", result.error.message);
  }

  if (scannerSessionId) {
    // 1. Consultar scan_sessions SERVER-SIDE con admin client restringido al tenant actual
    const { data: session, error: sessionError } = await admin
      .from("scan_sessions")
      .select("id, empresa_id, status, storage_bucket, storage_path, file_name, file_size_bytes, page_count, context_type")
      .eq("id", scannerSessionId)
      .eq("empresa_id", empresaId)
      .eq("status", "completed")
      .maybeSingle();

    if (
      sessionError ||
      !session ||
      session.context_type !== "invoice" ||
      session.storage_bucket !== "invoice-files" ||
      !session.storage_path
    ) {
      return { error: "Sesión de Control Scanner inválida o no disponible." };
    }

    const { data: original, error: originalError } = await admin.storage.from(session.storage_bucket).download(session.storage_path);
    if (originalError || !original) return { error: "No se pudo verificar el original del escáner." };
    verifiedExtraction = verifyInvoiceExtractionProof(str(formData, "extraction_proof"), {
      empresaId, actorId: profile.id, bytes: Buffer.from(await original.arrayBuffer()),
    });
    if (!verifiedExtraction || !invoiceIssuerMatches(verifiedExtraction.fields.provider_tax_id, provider.tax_id)) {
      return { error: "El RUC del emisor no coincide con el proveedor elegido o la lectura no corresponde al original del escáner." };
    }

    if (verifiedExtraction.fields.invoice_number !== invoiceNumber || verifiedExtraction.fields.invoice_date !== invoiceDate ||
      verifiedExtraction.fields.total !== total || (verifiedExtraction.fields.currency && verifiedExtraction.fields.currency !== currency)) {
      return { error: "Los datos finales no corresponden a la lectura del original del escáner." };
    }
    // 2. Anti-replay: verificación preliminar amigable
    const { data: existingAttachment } = await admin
      .from("attachments")
      .select("id")
      .eq("bucket", session.storage_bucket)
      .eq("path", session.storage_path)
      .maybeSingle();

    if (existingAttachment) {
      return { error: "El documento escaneado ya fue utilizado en otra factura." };
    }

    // 3. Tomar storage_path, file_name y file_size_bytes EXCLUSIVAMENTE de la fila validada de scan_sessions
    // El unique index idx_attachments_bucket_path_unique garantiza atomicidad contra carreras TOCTOU concurrentes (error 23505)
    const { data: attachment, error: attachmentError } = await admin
      .from("attachments")
      .insert({
        empresa_id: empresaId,
        bucket: session.storage_bucket,
        path: session.storage_path,
        file_name: session.file_name || "factura-escaneada.pdf",
        mime_type: "application/pdf",
        size_bytes: session.file_size_bytes || 0,
        uploaded_by: profile.id,
      })
      .select("id")
      .single();

    if (attachmentError) {
      if (attachmentError.code === "23505") {
        return { error: "El documento escaneado ya fue utilizado en otra factura." };
      }
      return { error: "No se pudo registrar el adjunto del escáner." };
    }

    if (!attachment) {
      return { error: "No se pudo registrar el adjunto del escáner." };
    }
    attachmentId = attachment.id;
    newlyCreatedScannerAttachmentId = attachment.id;
  } else if (file && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) return { error: "El archivo no puede superar los 20MB." };
    const path = `${providerId}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage
      .from("invoice-files")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) return { error: "No se pudo subir el archivo: " + uploadError.message };
    newlyUploadedManualPath = path;

    const { data: attachment, error: attachmentError } = await admin
      .from("attachments")
      .insert({
        empresa_id: empresaId,
        bucket: "invoice-files",
        path,
        file_name: file.name,
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: profile.id,
      })
      .select("id")
      .single();
    if (attachmentError || !attachment) {
      await cleanupFailedManualUpload();
      return { error: "No se pudo registrar el adjunto." };
    }
    attachmentId = attachment.id;
  }

  const supabase = await createClient();
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      provider_id: providerId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate || null,
      currency,
      exchange_rate: exchangeRate ?? null,
      subtotal: num(formData, "subtotal"),
      vat: num(formData, "vat"),
      total,
      timbrado: str(formData, "timbrado"),
      attachment_id: attachmentId,
      observations: str(formData, "observations"),
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !invoice) {
    await cleanupFailedManualUpload();
    // Si la creación de la factura falla y habíamos creado un attachment de escáner en esta ejecución,
    // limpiamos el registro huérfano en attachments para preservar atomicidad y permitir reintento.
    // NUNCA borramos el objeto de Storage.
    if (newlyCreatedScannerAttachmentId) {
      await admin
        .from("attachments")
        .delete()
        .eq("id", newlyCreatedScannerAttachmentId)
        .eq("empresa_id", empresaId);
    }

    return { error: error?.code === "23505" ? "Ya existe una factura con ese número para este proveedor." : (error?.message ?? "No se pudo crear la factura.") };
  }

  if (scannerSessionId) {
    await admin
      .from("scan_sessions")
      .update({ context_id: invoice.id })
      .eq("id", scannerSessionId)
      .eq("empresa_id", empresaId);
  }

  await logAudit(supabase, {
    action: "invoice.created",
    invoiceId: invoice.id,
    detail: {
      ...(arithmetic.status !== "VALIDA" ? { arithmetic_review: "confirmed" } : {}),
      ...(verifiedExtraction ? { document_sha256: verifiedExtraction.sha256,
        document_tax_id: verifiedExtraction.fields.provider_tax_id, issuer_check: "MATCH",
        extraction_actor: profile.id } : { issuer_check: "MANUAL_UNVERIFIED" }),
    },
  });

  if (verifiedExtraction && attachmentId) {
    const identity = await persistInvoiceIdentity(admin, {
      invoiceId: invoice.id, attachmentId, sha256: verifiedExtraction.sha256,
      fields: verifiedExtraction.fields, actorId: profile.id,
    });
    if (identity.error) {
      revalidatePath("/invoices");
      return { error: "La factura se creó pendiente, pero no se pudo registrar la identidad del original. No se vinculó ni habilitó pago: " + identity.error, invoiceId: invoice.id };
    }
  }

  // Líneas de detalle (revisadas por el humano en el diálogo): se persisten
  // juntas en una sola sentencia, antes de cualquier conciliación automática.
  if (dialogLines.length > 0) {
    const { error: linesError } = await insertInvoiceItems(supabase, {
      empresaId,
      invoiceId: invoice.id as string,
      items: dialogLines,
    });
    if (linesError) {
      await logAudit(supabase, {
        action: "invoice.lines_save_failed",
        invoiceId: invoice.id,
        detail: { error: linesError },
      });
      revalidatePath("/invoices");
      return {
        error: "La factura se creó, pero no se guardaron sus líneas. No se vinculó ni concilió; revisá la factura antes de continuar.",
        invoiceId: invoice.id as string,
      };
    }
  }

  // Si viene de "Cargar factura para esta orden", se vincula directo a esa OC;
  // si no, se intenta la conciliación automática por monto.
  let autoMatchedOrderId: string | null = null;
  let itemMatchWarning: string | undefined;
  if (!verifiedExtraction) {
    revalidatePath("/invoices");
    return { error: null, id: invoice.id, autoMatched: false, warning: "Factura manual pendiente: falta verificar el original antes de vincular una OC o habilitar pagos." };
  }
  if (linkOrderId) {
    const { error: matchError } = await supabase
      .from("invoice_order_matches")
      .insert({ invoice_id: invoice.id, authorized_order_id: linkOrderId, empresa_id: empresaId });
    if (!matchError) {
      autoMatchedOrderId = linkOrderId;
      revalidatePath(`/orders/${linkOrderId}`);
    } else {
      itemMatchWarning = "La factura se creó, pero no pudo vincularse a la orden elegida. Revisá el vínculo antes de aprobar el pago.";
    }
  } else {
    autoMatchedOrderId = await autoMatchInvoice(supabase, {
      invoiceId: invoice.id,
      providerId,
      total,
      empresaId,
      orderReference: verifiedExtraction ? verifiedExtraction.fields.order_reference : str(formData, "order_reference"),
      productDescription: verifiedExtraction ? verifiedExtraction.fields.product_description : str(formData, "product_description"),
    });
  }

  // Conciliación por ítem determinística sobre el vínculo autorizado: solo el
  // caso inequívoco crea matches; lo demás queda pendiente de revisión manual.
  if (autoMatchedOrderId) {
    const { error: itemError, pending } = await applyDeterministicItemMatches(supabase, {
      empresaId,
      invoiceId: invoice.id as string,
      orderId: autoMatchedOrderId,
    });
    if (itemError) {
      itemMatchWarning = "La factura se creó y vinculó, pero no se completó la conciliación por línea. Revisala antes de aprobar el pago.";
      await logAudit(supabase, {
        action: "invoice.item_match_failed",
        invoiceId: invoice.id,
        detail: { error: itemError },
      });
    } else if (pending > 0) {
      itemMatchWarning = `${pending} línea(s) quedaron sin imputación. Revisalas antes de aprobar el pago.`;
    }
  }

  // Cost Engine Flywheel: Alimentar observaciones de costo real si la factura se vinculó a una OC
  const activeOrderId = autoMatchedOrderId;
  if (activeOrderId) {
    try {
      const { recordCostObservationFromInvoice } = await import("@/lib/procurement/flywheel");
      await recordCostObservationFromInvoice(supabase, {
        empresaId,
        invoiceId: invoice.id,
        providerId,
        orderId: activeOrderId,
        itemDescription: str(formData, "product_description") || undefined,
        currency: currency || "PYG",
        exchangeRate: exchangeRate ?? undefined,
        invoiceDate: invoiceDate || undefined
      });
    } catch {
      // No bloquea la creación de factura si la tabla o módulo no está activo
    }
  }

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoice.id}`);
  return {
    error: null,
    id: invoice.id as string,
    autoMatched: autoMatchedOrderId !== null,
    ...(itemMatchWarning ? { warning: itemMatchWarning } : {}),
  };
}

export type OrderCandidate = {
  id: string;
  code: string;
  product: string;
  provider_id: string;
  provider_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
  facturado_amount: number;
  saldo: number;
  currency: string;
  status: string;
  authorized_at: string;
  score: number;
  scoreLabel: string;
};

/**
 * Busca órdenes de compra candidatas para vincular manualmente a una factura
 * PENDIENTE. Scoring fuzzy:
 *   3 = mismo proveedor + monto dentro de ±20%
 *   2 = mismo proveedor (cualquier monto)
 *   1 = proveedor distinto pero monto muy cercano (±5%) → posible error de LLM
 */
export async function getCandidateOrders(invoiceId: string): Promise<{
  error: string | null;
  candidates: OrderCandidate[];
  invoiceProvider: string;
  invoiceTotal: number;
  invoiceCurrency: string;
}> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, provider_id, total, currency")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .single();
  if (!invoice) return { error: "Factura no encontrada.", candidates: [], invoiceProvider: "", invoiceTotal: 0, invoiceCurrency: "PYG" };

  const { data: providerRow } = await supabase.from("providers").select("name").eq("id", invoice.provider_id).single();

  // Solo OCs del mismo proveedor — nunca mezclar con otros proveedores.
  const { data: orders } = await supabase
    .from("authorized_orders")
    .select("id, code, product, provider_id, provider_name, quantity, unit, unit_price, total_price, facturado_amount, currency, status, authorized_at")
    .eq("empresa_id", empresaId)
    .eq("provider_id", invoice.provider_id)
    .order("authorized_at", { ascending: false });

  const target = invoice.total as number;
  const candidates: OrderCandidate[] = [];

  for (const o of orders ?? []) {
    const saldo = (o.total_price as number) - ((o.facturado_amount as number) ?? 0);
    if (saldo <= 0) continue;

    const ref = Math.max(saldo, target);
    const diff = Math.abs(saldo - target) / ref;
    const within20 = diff <= 0.20;

    const score = within20 ? 2 : 1;
    const scoreLabel = within20 ? "Monto coincide" : "OC abierta";

    candidates.push({
      id: o.id as string,
      code: o.code as string,
      product: o.product as string,
      provider_id: o.provider_id as string,
      provider_name: o.provider_name as string,
      quantity: o.quantity as number,
      unit: o.unit as string,
      unit_price: o.unit_price as number,
      total_price: o.total_price as number,
      facturado_amount: (o.facturado_amount as number) ?? 0,
      saldo,
      currency: o.currency as string,
      status: o.status as string,
      authorized_at: o.authorized_at as string,
      score,
      scoreLabel,
    });
  }

  candidates.sort((a, b) => b.score - a.score || new Date(b.authorized_at).getTime() - new Date(a.authorized_at).getTime());

  return {
    error: null,
    candidates: candidates.slice(0, 50),
    invoiceProvider: providerRow?.name ?? "—",
    invoiceTotal: target,
    invoiceCurrency: invoice.currency as string,
  };
}

/** Vincula manualmente una factura PENDIENTE a una OC y la pasa a MATCH. */
export async function linkInvoiceToOrder(invoiceId: string, orderId: string): Promise<{
  error: string | null;
  itemMatched?: number;
  itemPending?: number;
  warning?: string;
}> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, status, provider_id, currency, exchange_rate, invoice_date")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .single();
  if (!invoice) return { error: "Factura no encontrada." };
  const identityCheck = await requireInvoiceIdentity(supabase, invoiceId, empresaId);
  if (identityCheck.error) return identityCheck;
  if (invoice.status !== "PENDIENTE") return { error: "Solo se pueden vincular facturas en estado Pendiente." };

  const { data: existing } = await supabase
    .from("invoice_order_matches")
    .select("id")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (existing) return { error: "Esta factura ya tiene una OC vinculada." };

  const { error: matchError } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: orderId, empresa_id: empresaId });
  if (matchError) return { error: "No se pudo vincular: " + matchError.message };

  // The match trigger performs canonical reconciliation, including overbilling review.

  // Conciliación por ítem determinística: solo el caso inequívoco crea matches.
  const { error: itemError, applied, pending } = await applyDeterministicItemMatches(supabase, {
    empresaId,
    invoiceId,
    orderId,
  });
  if (itemError) {
    await logAudit(supabase, {
      action: "invoice.item_match_failed",
      invoiceId,
      authorizedOrderId: orderId,
      detail: { error: itemError },
    });
  }

  // Cost Engine Flywheel: Alimentar observaciones de costo real
  try {
    const { recordCostObservationFromInvoice } = await import("@/lib/procurement/flywheel");
    await recordCostObservationFromInvoice(supabase, {
      empresaId,
      invoiceId,
      providerId: invoice.provider_id || "",
      orderId,
      currency: invoice.currency || "PYG",
      exchangeRate: (invoice as { exchange_rate?: number | null }).exchange_rate ?? undefined,
      invoiceDate: invoice.invoice_date || undefined
    });
  } catch {
    // Defensivo
  }

  await logAudit(supabase, { action: "invoice.order_manual_matched", invoiceId, authorizedOrderId: orderId });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath(`/orders/${orderId}`);
  return {
    error: null,
    itemMatched: applied.length,
    itemPending: pending,
    ...(itemError || pending > 0 ? {
      warning: itemError
        ? "La factura quedó vinculada, pero no se completó la conciliación por línea. Revisala antes de aprobar el pago."
        : `${pending} línea(s) quedaron sin imputación. Revisalas antes de aprobar el pago.`,
    } : {}),
  };
}
