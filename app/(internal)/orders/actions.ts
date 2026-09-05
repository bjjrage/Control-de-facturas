"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { CurrencyCode } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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

/** OC manual: compra directa, sin pasar por RFQ. */
export async function createManualOrder(formData: FormData) {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const providerId = str(formData, "provider_id");
  const product = str(formData, "product");
  const unit = str(formData, "unit");
  const currency = (str(formData, "currency") ?? "PYG") as CurrencyCode;
  const quantity = num(formData, "quantity");
  const unitPrice = num(formData, "unit_price");
  const totalPrice = num(formData, "total_price");

  if (!providerId || !product || !unit) return { error: "Completá proveedor, producto y unidad." };
  if (quantity === null || quantity <= 0) return { error: "La cantidad debe ser mayor a cero." };
  if (unitPrice === null || unitPrice <= 0) return { error: "El precio unitario debe ser mayor a cero." };
  if (totalPrice === null || totalPrice <= 0) return { error: "El total debe ser mayor a cero." };
  if (!CURRENCIES.includes(currency)) return { error: "Moneda inválida." };

  const { data: provider } = await supabase
    .from("providers")
    .select("id, name")
    .eq("id", providerId)
    .maybeSingle();
  if (!provider) return { error: "Proveedor no encontrado." };

  const { data: order, error } = await supabase
    .from("authorized_orders")
    .insert({
      provider_id: providerId,
      provider_name: provider.name,
      product,
      quantity,
      unit,
      unit_price: unitPrice,
      total_price: totalPrice,
      currency,
      vat_included: formData.get("vat_included") === "on",
      authorized_by: profile.id,
      is_cheapest: false,
      created_from: "manual",
    })
    .select("id")
    .single();

  if (error || !order) return { error: error?.message ?? "No se pudo crear la orden." };

  await logAudit(supabase, { action: "order.created_manual", authorizedOrderId: order.id });
  revalidatePath("/orders");
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
 */
export async function deleteOrder(orderId: string) {
  await requireProfile(["admin"]);
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("authorized_orders")
    .select("id, facturado_amount")
    .eq("id", orderId)
    .single();
  if (!order) return { error: "Orden no encontrada." };
  if (order.facturado_amount > 0) {
    return { error: "No se puede eliminar: ya tiene facturas vinculadas." };
  }

  const { count } = await supabase
    .from("invoice_order_matches")
    .select("id", { count: "exact", head: true })
    .eq("authorized_order_id", orderId);
  if (count && count > 0) {
    return { error: "No se puede eliminar: ya tiene facturas vinculadas." };
  }

  const { error } = await supabase.from("authorized_orders").delete().eq("id", orderId);
  if (error) return { error: error.message };

  await logAudit(supabase, { action: "order.deleted", authorizedOrderId: orderId });
  revalidatePath("/orders");
  redirect("/orders");
}
