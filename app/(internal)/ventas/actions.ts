"use server";

import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { lineTotal, docSaldo } from "@/lib/sales";
import { SalesDocType, SalesDocument, SalesDocumentItem, ReceiptMethod } from "@/lib/types";
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

export async function createSalesDocument(formData: FormData) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const client_id = str(formData, "client_id");
  const doc_type = (str(formData, "doc_type") ?? "REMISION") as SalesDocType;
  if (!client_id) return { error: "Elegí un cliente." };

  const items = parseItems(formData);
  if ("error" in items) return items;

  const { data: doc, error } = await supabase
    .from("sales_documents")
    .insert({
      client_id,
      doc_type,
      issue_date: str(formData, "issue_date") ?? new Date().toISOString().slice(0, 10),
      due_date: str(formData, "due_date"),
      currency: str(formData, "currency") ?? "PYG",
      notes: str(formData, "notes"),
      source_document_id: str(formData, "source_document_id"),
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !doc) return { error: error?.message ?? "No se pudo crear el documento." };

  const itemsError = await writeItems(supabase, doc.id, items);
  if (itemsError) return { error: itemsError.message };

  revalidatePath("/ventas");
  return { error: null, id: doc.id as string };
}

export async function updateSalesDocument(id: string, formData: FormData) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("sales_documents")
    .select("status, doc_type, acceptance_status")
    .eq("id", id)
    .single<{ status: string; doc_type: string; acceptance_status: string }>();
  if (!current) return { error: "Documento no encontrado." };
  if (current.status !== "BORRADOR") return { error: "Solo se puede editar un borrador." };
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

  const { error } = await supabase
    .from("sales_documents")
    .update({
      client_id: str(formData, "client_id") ?? undefined,
      doc_type: (str(formData, "doc_type") ?? "REMISION") as SalesDocType,
      issue_date: str(formData, "issue_date") ?? undefined,
      due_date: str(formData, "due_date"),
      currency: str(formData, "currency") ?? "PYG",
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
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("sales_documents")
    .select("status, total")
    .eq("id", id)
    .single<{ status: string; total: number }>();
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.status !== "BORRADOR") return { error: "El documento ya fue emitido." };
  if (doc.total <= 0) return { error: "El total debe ser mayor a cero." };

  const { error } = await supabase.from("sales_documents").update({ status: "EMITIDA" }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/ventas");
  revalidatePath(`/ventas/${id}`);
  return { error: null };
}

export async function voidSalesDocument(id: string) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
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
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: doc } = await supabase.from("sales_documents").select("status").eq("id", id).single<{ status: string }>();
  if (doc && doc.status !== "BORRADOR") return { error: "Solo se puede eliminar un borrador. Anulalo en su lugar." };
  const { error } = await supabase.from("sales_documents").delete().eq("id", id);
  if (error) return { error: error.message };
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

export async function convertSalesDocument(fromId: string, toType: SalesDocType) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: source } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", fromId)
    .single<SalesDocument>();
  if (!source) return { error: "Documento no encontrado." };

  const { data: sourceItems } = await supabase
    .from("sales_document_items")
    .select("*")
    .eq("sales_document_id", fromId)
    .order("created_at")
    .returns<SalesDocumentItem[]>();

  const baseNote = source.notes ? `\n\n${source.notes}` : "";
  const { data: newDoc, error } = await supabase
    .from("sales_documents")
    .insert({
      client_id: source.client_id,
      doc_type: toType,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: source.due_date,
      currency: source.currency,
      notes: `Generado desde ${source.code}${baseNote}`,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error || !newDoc) return { error: error?.message ?? "No se pudo crear el documento." };

  if (sourceItems && sourceItems.length > 0) {
    const itemsError = await writeItems(
      supabase,
      newDoc.id,
      sourceItems.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        vat_rate: it.vat_rate,
      }))
    );
    if (itemsError) return { error: itemsError.message };
  }

  revalidatePath("/ventas");
  return { error: null, id: newDoc.id as string };
}
