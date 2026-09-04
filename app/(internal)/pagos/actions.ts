"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createPaymentOrder(formData: FormData): Promise<{ error: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const providerId = formData.get("provider_id") as string | null;
  const invoiceIds = formData.getAll("invoice_ids") as string[];

  if (!providerId) return { error: "Seleccioná un proveedor." };
  if (invoiceIds.length === 0) return { error: "Seleccioná al menos una factura." };

  const { data: code } = await supabase.rpc("next_op_code");

  const { data: op, error: opError } = await supabase
    .from("payment_orders")
    .insert({
      empresa_id: empresaId,
      code: code as string,
      provider_id: providerId,
      status: "EMITIDA",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (opError || !op) return { error: "No se pudo crear la OP." };

  const { error: linkError } = await supabase.from("payment_order_invoices").insert(
    invoiceIds.map((invoiceId) => ({
      empresa_id: empresaId,
      payment_order_id: op.id,
      invoice_id: invoiceId,
    }))
  );

  if (linkError) {
    await supabase.from("payment_orders").delete().eq("id", op.id);
    return { error: "No se pudo vincular las facturas: " + linkError.message };
  }

  await logAudit(supabase, {
    action: "payment_order.created",
    detail: { op_id: op.id, invoice_count: invoiceIds.length },
  });

  revalidatePath("/pagos");
  revalidatePath("/invoices");
  redirect(`/pagos/${op.id}`);
}

export async function createPaymentOrderFromInvoice(invoiceId: string): Promise<{ error: string }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, provider_id, status")
    .eq("id", invoiceId)
    .eq("empresa_id", empresaId)
    .single();

  if (!invoice) return { error: "Factura no encontrada." };
  if (invoice.status !== "APTO_PARA_PAGO") return { error: "Solo facturas aptas para pago." };

  const { data: existing } = await supabase
    .from("payment_order_invoices")
    .select("payment_order_id")
    .eq("invoice_id", invoiceId)
    .maybeSingle();

  if (existing) return { error: "Esta factura ya está en una OP." };

  const { data: code } = await supabase.rpc("next_op_code");

  const { data: op, error: opError } = await supabase
    .from("payment_orders")
    .insert({
      empresa_id: empresaId,
      code: code as string,
      provider_id: invoice.provider_id,
      status: "EMITIDA",
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (opError || !op) return { error: "No se pudo crear la OP." };

  const { error: linkError } = await supabase.from("payment_order_invoices").insert({
    empresa_id: empresaId,
    payment_order_id: op.id,
    invoice_id: invoiceId,
  });

  if (linkError) {
    await supabase.from("payment_orders").delete().eq("id", op.id);
    return { error: "No se pudo vincular la factura." };
  }

  await logAudit(supabase, {
    action: "payment_order.created",
    detail: { op_id: op.id, from_invoice: invoiceId },
  });

  revalidatePath("/pagos");
  revalidatePath(`/invoices/${invoiceId}`);
  redirect(`/pagos/${op.id}`);
}

export async function markPaymentOrderExecuted(opId: string): Promise<{ error: string | null }> {
  const profile = await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: op } = await supabase
    .from("payment_orders")
    .select("id, status")
    .eq("id", opId)
    .eq("empresa_id", empresaId)
    .single();

  if (!op) return { error: "OP no encontrada." };
  if (op.status !== "EMITIDA") return { error: "La OP ya fue ejecutada." };

  const { data: links } = await supabase
    .from("payment_order_invoices")
    .select("invoice_id")
    .eq("payment_order_id", opId);

  const invoiceIds = (links ?? []).map((l) => l.invoice_id as string);

  await supabase
    .from("payment_orders")
    .update({ status: "EJECUTADA", executed_at: new Date().toISOString() })
    .eq("id", opId)
    .eq("empresa_id", empresaId);

  if (invoiceIds.length > 0) {
    await supabase
      .from("invoices")
      .update({ status: "PAGADO" })
      .in("id", invoiceIds)
      .eq("empresa_id", empresaId);
  }

  await logAudit(supabase, {
    action: "payment_order.executed",
    detail: { op_id: opId, invoice_count: invoiceIds.length },
  });

  revalidatePath(`/pagos/${opId}`);
  revalidatePath("/pagos");
  revalidatePath("/invoices");
  return { error: null };
}
