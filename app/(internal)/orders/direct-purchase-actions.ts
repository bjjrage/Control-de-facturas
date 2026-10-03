"use server";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  directItemSchema,
  type DirectPreview,
} from "@/lib/rfq/direct-purchase";
import { needOriginArgs } from "@/lib/procurement/need-origin";
import { rpc } from "@/lib/rfq/service";
export async function previewDirectPurchaseAction(fd: FormData) {
  try {
    const profile = await requireProfile([
      "comercial",
      "administracion",
      "admin",
    ]);
    if (!profile.active) throw new Error("Cuenta inactiva");
    const items = directItemSchema
      .array()
      .min(1)
      .max(500)
      .parse(JSON.parse(String(fd.get("items") ?? "")));
    const header = {
      provider_id: fd.get("provider_id"),
      project_id: fd.get("project_id"),
      currency: fd.get("currency"),
      vat_included: fd.get("vat_included") === "on",
      freight: Number(fd.get("freight")),
      payment_terms: fd.get("payment_terms"),
      observations: fd.get("observations"),
    };
    if (fd.get("freight") === null || fd.get("freight") === "")
      throw new Error("Flete obligatorio");
    const origin = fd.get("need_origin");
    const data = await rpc<DirectPreview>(
      await createClient(),
      origin ? "weekly_plan_need_direct_preview" : "direct_purchase_preview",
      { p_header: header, p_items: items, ...(origin ? needOriginArgs(JSON.parse(String(origin))) : {}) },
    );
    return { error: null, data };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Preview inválido",
      data: null,
    };
  }
}
export async function confirmDirectPurchaseAction(
  id: string,
  hash: string,
  confirm: boolean,
) {
  try {
    const profile = await requireProfile([
      "comercial",
      "administracion",
      "admin",
    ]);
    if (!profile.active) throw new Error("Cuenta inactiva");
    const orderId = await rpc<string>(
      await createClient(),
      "direct_purchase_confirm",
      { p_preview_id: id, p_hash: hash, p_confirm: confirm },
    );
    revalidatePath("/orders");
    return { error: null, id: orderId };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Confirmación fallida",
      id: null,
    };
  }
}
