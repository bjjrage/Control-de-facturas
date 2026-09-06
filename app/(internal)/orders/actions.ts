"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireEmpresaId } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { CurrencyCode } from "@/lib/types";
import { revalidatePath } from "next/cache";

const CURRENCIES: CurrencyCode[] = ["PYG", "USD", "EUR", "BRL", "ARS"];

function str(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(fd: FormData, k: string) {
  const v = fd.get(k);
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type OrderItemInput = {
  product: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total_price: number;
};

/** OC manual: compra directa, sin pasar por RFQ. */
export async function createManualOrder(formData: FormData) {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const providerId = str(formData, "provider_id");
  const currency = (str(formData, "currency") ?? "PYG") as CurrencyCode;

  if (!providerId) return { error: "Elegí un proveedor." };
  if (!CURRENCIES.includes(currency)) return { error: "Moneda inválida." };

  // Parse items sent from the multi-row form.
  let items: OrderItemInput[] = [];
  const itemsRaw = str(formData, "items");
  if (itemsRaw) {
    try {
      items = JSON.parse(itemsRaw) as OrderItemInput[];
    } catch {
      return { error: "Error al leer los ítems de la orden." };
    }
  }

  if (!items.length) return { error: "Agregá al menos un ítem." };
  for (const item of items) {
    if (!item.product?.trim()) return { error: "Completá la descripción de todos los ítems." };
    if (!item.quantity || item.quantity <= 0) return { error: "Todas las cantidades deben ser mayores a cero." };
    if (!item.unit?.trim()) return { error: "Completá la unidad de todos los ítems." };
    if (item.unit_price < 0) return { error: "El precio unitario no puede ser negativo." };
    if (!item.total_price || item.total_price <= 0) return { error: "El total de cada ítem debe ser mayor a cero." };
  }

  const grandTotal = items.reduce((s, r) => s + r.total_price, 0);
  // Legacy columns: use first item (keeps backward compat with existing OC detail/list pages).
  const first = items[0];

  const { data: provider } = await supabase
    .from("providers")
    .select("id, name")
    .eq("id", providerId)
    .maybeSingle();
  if (!provider) return { error: "Proveedor no encontrado." };

  const projectId = str(formData, "project_id");

  const { data: order, error } = await supabase
    .from("authorized_orders")
    .insert({
      provider_id: providerId,
      provider_name: provider.name,
      product: first.product.trim(),
      quantity: first.quantity,
      unit: first.unit.trim(),
      unit_price: first.unit_price,
      total_price: grandTotal,
      currency,
      vat_included: formData.get("vat_included") === "on",
      authorized_by: profile.id,
      is_cheapest: false,
      created_from: "manual",
      project_id: projectId || null,
    })
    .select("id")
    .single();

  if (error || !order) return { error: error?.message ?? "No se pudo crear la orden." };

  // Insert all line items into authorized_order_items.
  const itemRows = items.map((item, idx) => ({
    order_id: order.id,
    empresa_id: profile.empresa_id,
    product: item.product.trim(),
    quantity: item.quantity,
    unit: item.unit.trim(),
    unit_price: item.unit_price,
    total_price: item.total_price,
    sort_order: idx,
  }));
  const { error: itemsError } = await supabase.from("authorized_order_items").insert(itemRows);
  if (itemsError) {
    // Roll back the order header to avoid orphan — best effort.
    await supabase.from("authorized_orders").delete().eq("id", order.id);
    return { error: `Error al guardar los ítems: ${itemsError.message}` };
  }

  await logAudit(supabase, { action: "order.created_manual", authorizedOrderId: order.id });
  revalidatePath("/orders");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { error: null, id: order.id as string };
}

/** OC generada desde una factura ya recibida (la factura queda vinculada). */
export async function createOrderFromInvoice(
  invoiceId: string,
  fields: { product: string; quantity: number; unit: string }
) {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, provider_id, total, currency, providers(name)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { error: "Factura no encontrada." };

  const { data: existingMatch } = await supabase
    .from("invoice_order_matches")
    .select("id")
    .eq("invoice_id", invoiceId)
    .maybeSingle();
  if (existingMatch) return { error: "La factura ya está vinculada a una orden." };

  if (!fields.product.trim() || !fields.unit.trim()) return { error: "Completá producto y unidad." };
  if (!Number.isFinite(fields.quantity) || fields.quantity <= 0) return { error: "Cantidad inválida." };

  const providerName =
    (invoice as unknown as { providers: { name: string } | null }).providers?.name ?? "Proveedor";

  const { data: order, error } = await supabase
    .from("authorized_orders")
    .insert({
      provider_id: invoice.provider_id,
      provider_name: providerName,
      product: fields.product.trim(),
      quantity: fields.quantity,
      unit: fields.unit.trim(),
      unit_price: invoice.total / fields.quantity,
      total_price: invoice.total,
      currency: invoice.currency,
      vat_included: false,
      authorized_by: profile.id,
      is_cheapest: false,
      created_from: "invoice",
    })
    .select("id")
    .single();

  if (error || !order) return { error: error?.message ?? "No se pudo crear la orden." };

  const { error: matchError } = await supabase
    .from("invoice_order_matches")
    .insert({ invoice_id: invoiceId, authorized_order_id: order.id, empresa_id: empresaId });
  if (matchError) return { error: `Orden creada pero no se pudo vincular la factura: ${matchError.message}` };

  await logAudit(supabase, {
    action: "order.created_from_invoice",
    invoiceId,
    authorizedOrderId: order.id,
  });

  revalidatePath("/orders");
  revalidatePath(`/invoices/${invoiceId}`);
  return { error: null, id: order.id as string };
}

/**
 * Hard-delete de una OC: solo admin, y solo si nunca se le vinculó una
 * factura (facturado_amount = 0 y sin filas en invoice_order_matches).
 * Pensado para limpiar duplicados de carga manual — una OC ya facturada
 * nunca se borra, se cancela a mano si hace falta.
 *
 * Usa el admin client a propósito: authorized_orders no tiene policy de
 * DELETE en RLS (es un registro de auditoría, ver 0004_rls.sql), así que un
 * delete con el cliente normal no falla — simplemente no borra nada (0 filas
 * afectadas, sin error). Por eso acá se scopea cada query a mano por
 * empresa_id, igual que deleteInvoice. También hay que limpiar audit_logs
 * primero: toda orden manual queda logueada (order.created_manual) y esa FK
 * no tiene cascade, así que sin este paso el delete real fallaba por
 * violación de foreign key.
 */
export async function deleteOrder(orderId: string) {
  const empresaId = await requireEmpresaId(["admin"]);
  const supabase = await createClient(); // solo para el audit log — necesita auth.uid()
  const admin = createAdminClient();

  const { data: order } = await admin
    .from("authorized_orders")
    .select("id, facturado_amount")
    .eq("id", orderId)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!order) return { error: "Orden no encontrada." };
  if (order.facturado_amount > 0) {
    return { error: "No se puede eliminar: ya tiene facturas vinculadas." };
  }

  const { count } = await admin
    .from("invoice_order_matches")
    .select("id", { count: "exact", head: true })
    .eq("authorized_order_id", orderId)
    .eq("empresa_id", empresaId);
  if (count && count > 0) {
    return { error: "No se puede eliminar: ya tiene facturas vinculadas." };
  }

  await admin.from("audit_logs").delete().eq("authorized_order_id", orderId).eq("empresa_id", empresaId);

  const { error, count: deletedCount } = await admin
    .from("authorized_orders")
    .delete({ count: "exact" })
    .eq("id", orderId)
    .eq("empresa_id", empresaId);
  if (error) return { error: error.message };
  if (!deletedCount) return { error: "No se pudo eliminar la orden." };

  // authorized_order_id ya no existe tras el delete — se loguea el código en detail.
  await logAudit(supabase, { action: "order.deleted", detail: { order_id: orderId } });
  revalidatePath("/orders");
  return { error: null };
}
