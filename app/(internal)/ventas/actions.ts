"use server";

import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { lineTotal, docSaldo } from "@/lib/sales";
import { SalesDocType, ReceiptMethod } from "@/lib/types";
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
  const doc_type = (str(formData, "doc_type") ?? "NOTA_VENTA") as SalesDocType;
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

  const { data: current } = await supabase.from("sales_documents").select("status").eq("id", id).single<{ status: string }>();
  if (!current) return { error: "Documento no encontrado." };
  if (current.status !== "BORRADOR") return { error: "Solo se puede editar un borrador." };

  const items = parseItems(formData);
  if ("error" in items) return items;

  const { error } = await supabase
    .from("sales_documents")
    .update({
      client_id: str(formData, "client_id") ?? undefined,
      doc_type: (str(formData, "doc_type") ?? "NOTA_VENTA") as SalesDocType,
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

  const { error } = await supabase.from("sales_receipts").insert({
    sales_document_id: docId,
    amount,
    receipt_date: str(formData, "receipt_date") ?? new Date().toISOString().slice(0, 10),
    method: (str(formData, "method") ?? "TRANSFERENCIA") as ReceiptMethod,
    reference: str(formData, "reference"),
    notes: str(formData, "notes"),
    created_by: profile.id,
  });
  if (error) return { error: error.message };
  revalidatePath("/ventas");
  revalidatePath(`/ventas/${docId}`);
  return { error: null };
}

export async function deleteReceipt(receiptId: string, docId: string) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.from("sales_receipts").delete().eq("id", receiptId);
  if (error) return { error: error.message };
  revalidatePath("/ventas");
  revalidatePath(`/ventas/${docId}`);
  return { error: null };
}
