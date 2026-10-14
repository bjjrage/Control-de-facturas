import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AuthorizedOrder, AuthorizedOrderItem, OcRecepcion } from "@/lib/types";
import type { ReceiptEvidenceView } from "@/app/(internal)/orders/[id]/recepcion-section";
import { ProjectReceiptsList } from "./project-receipts-list";

export type ProjectReceiptOrder = Pick<AuthorizedOrder, "id" | "code" | "provider_name" | "project_id">;
export type ProjectReceiptItem = AuthorizedOrderItem & { quantity_text: string };

export async function ProjectReceiptsSection({ projectId }: { projectId: string }) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const db = await createClient();
  const project = await db.from("projects").select("id").eq("empresa_id", profile.empresa_id).eq("id", projectId).maybeSingle();
  if (project.error) throw new Error(project.error.message);
  if (!project.data) notFound();
  const [orders, products, locations] = await Promise.all([
    db.from("authorized_orders").select("id,code,provider_name,project_id").eq("empresa_id", profile.empresa_id).eq("project_id", projectId).order("authorized_at", { ascending: false }).returns<ProjectReceiptOrder[]>(),
    db.from("productos").select("id,nombre,unidad,activo").eq("empresa_id", profile.empresa_id).order("nombre"),
    db.from("inventory_locations").select("id").eq("empresa_id", profile.empresa_id).eq("project_id", projectId).eq("active", true),
  ]);
  for (const result of [orders, products, locations]) if (result.error) throw new Error(result.error.message);
  const ids = (orders.data ?? []).map(order => order.id);
  const [items, receipts] = ids.length ? await Promise.all([
    db.from("authorized_order_items").select("*,quantity_text:quantity::text").eq("empresa_id", profile.empresa_id).in("order_id", ids).order("sort_order").returns<ProjectReceiptItem[]>(),
    db.from("oc_recepciones").select("*,oc_recepcion_items(*)").eq("empresa_id", profile.empresa_id).in("order_id", ids).order("created_at", { ascending: false }).returns<OcRecepcion[]>(),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  for (const result of [items, receipts]) if (result.error) throw new Error(result.error.message);
  const evidenceByReceipt: Record<string, ReceiptEvidenceView[]> = {};
  const receiptIds = (receipts.data ?? []).map(receipt => receipt.id);
  if (receiptIds.length) {
    const files = await db.from("inventory_receipt_evidence").select("id,receipt_id,storage_bucket,storage_path,file_name,size_bytes").eq("empresa_id", profile.empresa_id).in("receipt_id", receiptIds);
    if (files.error) throw new Error(files.error.message);
    const admin = createAdminClient();
    await Promise.all((files.data ?? []).map(async file => {
      if (file.storage_bucket !== "warehouse-evidence") return;
      const signed = await admin.storage.from("warehouse-evidence").createSignedUrl(file.storage_path, 600);
      (evidenceByReceipt[file.receipt_id] ??= []).push({ id: file.id, fileName: file.file_name, sizeBytes: file.size_bytes, url: signed.data?.signedUrl ?? null });
    }));
  }
  return <ProjectReceiptsList projectId={projectId} orders={orders.data ?? []} items={items.data ?? []}
    receipts={receipts.data ?? []} products={products.data ?? []} evidenceByReceipt={evidenceByReceipt}
    currentUserId={profile.id} hasLocation={Boolean(locations.data?.length)} />;
}
