"use server";

import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { lineTotal, docSaldo, isSalesEditorType } from "@/lib/sales";
import { SalesDocType, SalesDocument, ReceiptMethod } from "@/lib/types";
import { canLinkSalesDocument, loadPostOtSnapshotForQuotation, validateSalesEmission, loadSalesDocumentDescendants } from "@/lib/sales-post-ot";
import { revalidatePath } from "next/cache";

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

type ItemInput = { description: string; quantity: number; unit_price: number; vat_rate: 0 | 5 | 10 };

function parseItems(fd: FormData): ItemInput[] | { error: string } {
  const raw = fd.get("items");
  if (typeof raw !== "string") return { error: "Faltan los ítems." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Ítems inválidos." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "Agregá al menos un ítem." };
  const items: ItemInput[] = [];
  for (const it of parsed) {
    const description = String((it as ItemInput).description ?? "").trim();
    const quantity = Number((it as ItemInput).quantity);
    const unit_price = Number((it as ItemInput).unit_price);
    const vat_rate = Number((it as ItemInput).vat_rate) as 0 | 5 | 10;
    if (!description) return { error: "Cada ítem necesita descripción." };
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Cantidad inválida en "${description}".` };
    if (!Number.isFinite(unit_price) || unit_price < 0) return { error: `Precio inválido en "${description}".` };
    if (![0, 5, 10].includes(vat_rate)) return { error: `IVA inválido en "${description}".` };
    items.push({ description, quantity, unit_price, vat_rate });
  }
  return items;
}

async function writeItems(supabase: Awaited<ReturnType<typeof createClient>>, docId: string, items: ItemInput[]) {
  await supabase.from("sales_document_items").delete().eq("sales_document_id", docId);
  const { error } = await supabase.from("sales_document_items").insert(
    items.map((it) => ({
      sales_document_id: docId,
      description: it.description,
      quantity: it.quantity,
      unit_price: it.unit_price,
      vat_rate: it.vat_rate,
      line_total: lineTotal(it.quantity, it.unit_price),
    }))
  );
  return error;
}

async function validateSourceDocument(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  empresaId: string;
  targetType: SalesDocType;
  sourceDocumentId: string | null;
  workOrderId?: string | null;
  clientId: string;
  currency: string;
}): Promise<{ error: string | null }> {
  const { supabase, empresaId, targetType, sourceDocumentId, workOrderId, clientId, currency } = input;
  if (!sourceDocumentId) {
    return { error: workOrderId ? "La OT necesita un documento de origen válido." : null };
  }

  const { data: source } = await supabase
    .from("sales_documents")
    .select("id, empresa_id, client_id, currency, doc_type, status, acceptance_status")
    .eq("id", sourceDocumentId)
    .eq("empresa_id", empresaId)
    .maybeSingle<Pick<SalesDocument, "id" | "empresa_id" | "client_id" | "currency" | "doc_type" | "status" | "acceptance_status">>();
  if (!source) return { error: "El documento de origen no existe para esta empresa." };
  if (!canLinkSalesDocument(source.doc_type, targetType)) {
    return { error: "El tipo de documento de origen no corresponde a este documento." };
  }
  if (source.status === "ANULADA") return { error: "No se puede crear un documento desde un origen anulado." };
  if (source.client_id !== clientId || source.currency !== currency) {
    return { error: "El cliente y la moneda deben coincidir con el documento de origen." };
  }

  if (source.doc_type === "PROFORMA") {
    if (source.acceptance_status !== "ACCEPTED") {
      return { error: "La proforma debe estar aceptada antes de preparar documentos desde su OT." };
    }
    const snapshot = await loadPostOtSnapshotForQuotation(supabase, source.id, empresaId);
    if (!snapshot) return { error: "No se pudo verificar la OT y la versión aceptada de esta proforma." };
    if (workOrderId && snapshot.workOrder.id !== workOrderId) {
      return { error: "La OT no corresponde al documento de origen." };
    }
  } else if (workOrderId) {
    return { error: "La OT indicada no corresponde al documento de origen." };
  }

  return { error: null };
}

export async function createSalesDocument(formData: FormData) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const client_id = str(formData, "client_id");
  const rawDocType = str(formData, "doc_type") ?? "REMISION";
  if (!isSalesEditorType(rawDocType)) return { error: "Tipo de documento invalido." };
  const doc_type = rawDocType;
  if (!client_id) return { error: "Elegí un cliente." };

  const currency = str(formData, "currency") ?? "PYG";
  const sourceDocumentId = str(formData, "source_document_id");
  const workOrderId = str(formData, "work_order_id");
  const sourceValidation = await validateSourceDocument({
    supabase,
    empresaId: profile.empresa_id,
    targetType: doc_type,
    sourceDocumentId,
    workOrderId,
    clientId: client_id,
    currency,
  });
  if (sourceValidation.error) return sourceValidation;

  const items = parseItems(formData);
  if ("error" in items) return items;

  const { data: doc, error } = await supabase
    .from("sales_documents")
    .insert({
      client_id,
      doc_type,
      issue_date: str(formData, "issue_date") ?? new Date().toISOString().slice(0, 10),
      due_date: str(formData, "due_date"),
      currency,
      notes: str(formData, "notes"),
      source_document_id: sourceDocumentId,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !doc) return { error: error?.message ?? "No se pudo crear el documento." };

  const itemsError = await writeItems(supabase, doc.id, items);
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/ventas");
  if (workOrderId) revalidatePath(`/ordenes-trabajo/${workOrderId}`);
  return { error: null, id: doc.id as string };
}

export async function updateSalesDocument(id: string, formData: FormData) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("sales_documents")
    .select("status, doc_type, acceptance_status, source_document_id, client_id, currency")
    .eq("id", id)
    .single<Pick<SalesDocument, "status" | "doc_type" | "acceptance_status" | "source_document_id" | "client_id" | "currency">>();
  if (!current) return { error: "Documento no encontrado." };
  if (current.status !== "BORRADOR") return { error: "Solo se puede editar un borrador." };
  if (formData.has("source_document_id") && str(formData, "source_document_id") !== current.source_document_id) {
    return { error: "El documento de origen es inmutable: no se puede cambiar ni borrar." };
  }
  // La cotizaci├│n aceptada es inmutable: la OT ya fotografi├│ sus ├¡tems.
  // Editar una PENDING invalida el link (bump de quotation_version, migraci├│n 0090).
  if (current.doc_type === "PROFORMA" && current.acceptance_status === "ACCEPTED") {
    return { error: "La cotizaci├│n ya fue aceptada y gener├│ una Orden de Trabajo: no se puede editar." };
  }
  if (
    current.doc_type === "PROFORMA" &&
    (current.acceptance_status === "REJECTED" || current.acceptance_status === "EXPIRED")
  ) {
    return { error: "La cotizaci├│n fue rechazada o venci├│: reabrila a borrador antes de editarla." };
  }

  const items = parseItems(formData);
  if ("error" in items) return items;

  const nextDocType = str(formData, "doc_type") ?? "REMISION";
  if (!isSalesEditorType(nextDocType)) return { error: "Tipo de documento invalido." };
  const nextClientId = str(formData, "client_id") ?? current.client_id;
  const nextCurrency = str(formData, "currency") ?? "PYG";
  const sourceValidation = await validateSourceDocument({
    supabase,
    empresaId: profile.empresa_id,
    targetType: nextDocType,
    sourceDocumentId: current.source_document_id,
    clientId: nextClientId,
    currency: nextCurrency,
  });
  if (sourceValidation.error) return sourceValidation;

  const { error } = await supabase
    .from("sales_documents")
    .update({
      client_id: nextClientId,
      doc_type: nextDocType,
      issue_date: str(formData, "issue_date") ?? undefined,
      due_date: str(formData, "due_date"),
      currency: nextCurrency,
      notes: str(formData, "notes"),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  const itemsError = await writeItems(supabase, id, items);
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/ventas");
  revalidatePath(`/ventas/${id}`);
  return { error: null, id };
}

export async function emitSalesDocument(id: string) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id)
    .single<SalesDocument>();
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.status !== "BORRADOR") return { error: "El documento ya fue emitido." };
  if (doc.total <= 0) return { error: "El total debe ser mayor a cero." };
  const lineage = await validateSalesEmission(supabase, doc, profile.empresa_id);
  if (lineage.error) return lineage;

  const { error } = await supabase.from("sales_documents").update({ status: "EMITIDA" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/ventas");
  revalidatePath(`/ventas/${id}`);
  return { error: null };
}

export async function voidSalesDocument(id: string) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const descendants = await loadSalesDocumentDescendants(supabase, id, profile.empresa_id);
  if (descendants.error) return { error: descendants.error };
  if (descendants.documents.some((child) => child.status !== "ANULADA")) {
    return { error: "Anula primero los documentos derivados activos, desde el ultimo hacia el origen." };
  }
  const { data: doc } = await supabase
    .from("sales_documents")
    .select("cobrado_amount")
    .eq("id", id)
    .single<{ cobrado_amount: number }>();
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.cobrado_amount > 0) return { error: "Tiene cobros registrados: eliminalos antes de anular." };

  const { error } = await supabase.from("sales_documents").update({ status: "ANULADA" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/ventas");
  revalidatePath(`/ventas/${id}`);
  return { error: null };
}

export async function deleteSalesDocument(id: string) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const descendants = await loadSalesDocumentDescendants(supabase, id, profile.empresa_id);
  if (descendants.error) return { error: descendants.error };
  if (descendants.documents.length) {
    return { error: "Tiene documentos derivados: elimina primero los borradores hijos. La trazabilidad debe conservarse." };
  }
  const { data: doc } = await supabase.from("sales_documents").select("status").eq("id", id).single<{ status: string }>();
  if (doc && doc.status !== "BORRADOR") return { error: "Solo se puede eliminar un borrador. Anulalo en su lugar." };
  const { error } = await supabase.from("sales_documents").delete().eq("id", id);
  if (error) return { error: error.code === "23503" ? "Tiene documentos derivados: la trazabilidad debe conservarse." : error.message };
  revalidatePath("/ventas");
  return { error: null };
}

export async function addReceipt(docId: string, formData: FormData) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("status, total, cobrado_amount")
    .eq("id", docId)
    .single<{ status: string; total: number; cobrado_amount: number }>();
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.status !== "EMITIDA" && doc.status !== "COBRADA_PARCIAL") {
    return { error: "Solo se registran cobros en documentos emitidos." };
  }

  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return { error: "El monto debe ser mayor a cero." };
  const saldo = docSaldo(doc.total, doc.cobrado_amount);
  if (amount - saldo > 0.01) return { error: `El cobro supera el saldo (${saldo}).` };

  const cuentaId = str(formData, "cuenta_id");
  const receiptDate = str(formData, "receipt_date") ?? new Date().toISOString().slice(0, 10);
  const method = (str(formData, "method") ?? "TRANSFERENCIA") as ReceiptMethod;
  const reference = str(formData, "reference");
  const notes = str(formData, "notes");

  const { data: atomicReceiptId, error: atomicErr } = await supabase.rpc("registrar_cobro_atomico", {
    p_empresa_id: profile.empresa_id,
    p_sales_document_id: docId,
    p_amount: amount,
    p_method: method,
    p_receipt_date: receiptDate,
    p_reference: reference,
    p_notes: notes,
    p_cuenta_id: cuentaId ?? null,
    p_created_by: profile.id,
  });

  if (atomicErr) return { error: atomicErr.message };
  if (!atomicReceiptId) return { error: "No se pudo confirmar la creación del cobro." };

  const { data: persistedReceipt, error: readError } = await supabase
    .from("sales_receipts")
    .select("id")
    .eq("id", atomicReceiptId)
    .eq("empresa_id", profile.empresa_id)
    .eq("sales_document_id", docId)
    .maybeSingle();
  if (readError || !persistedReceipt) {
    return { error: "El cobro se registró, pero no se pudo verificar su lectura posterior." };
  }

  revalidatePath("/ventas");
  revalidatePath(`/ventas/${docId}`);
  revalidatePath("/cobros");
  revalidatePath("/tesoreria");
  return { error: null };
}

export async function reverseReceipt(receiptId: string, docId: string) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: reversedReceiptId, error } = await supabase.rpc("revertir_cobro_atomico", {
    p_empresa_id: profile.empresa_id,
    p_sales_receipt_id: receiptId,
    p_reversal_reason: "Reversión manual solicitada desde el detalle de ventas",
    p_created_by: profile.id,
  });
  if (error) return { error: error.message };

  const { data: persistedReceipt, error: readError } = await supabase
    .from("sales_receipts")
    .select("id, reversed_at")
    .eq("id", reversedReceiptId ?? receiptId)
    .eq("empresa_id", profile.empresa_id)
    .eq("sales_document_id", docId)
    .maybeSingle();
  if (readError || !persistedReceipt?.reversed_at) {
    return { error: "La reversa se ejecutó, pero no se pudo verificar su lectura posterior." };
  }

  await logAudit(supabase, {
    action: "sales_receipt.reversed",
    detail: { receipt_id: receiptId, document_id: docId },
  });
  revalidatePath("/ventas");
  revalidatePath(`/ventas/${docId}`);
  revalidatePath("/cobros");
  revalidatePath("/tesoreria");
  return { error: null };
}
