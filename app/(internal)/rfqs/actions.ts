"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { sanitizeFileName } from "@/lib/storage";
import { needOriginArgs } from "@/lib/procurement/need-origin";
import { createCanonicalRfq, rpc } from "@/lib/rfq/service";
import { revalidatePath } from "next/cache";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function str(formData: FormData, key: string) {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export type PurchaseFormOptions = {
  projects: { id: string; name: string; code: string }[];
  products: { id: string; nombre: string; unidad: string }[];
  central: { id: string; name: string } | null;
};

export async function getPurchaseFormOptions(): Promise<{ data: PurchaseFormOptions | null; error: string | null }> {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const db = await createClient();
  try {
    const [projects, products, central] = await Promise.all([
      db.from("projects").select("id,name,code").eq("empresa_id", profile.empresa_id).order("name"),
      db.from("productos").select("id,nombre,unidad").eq("empresa_id", profile.empresa_id).eq("activo", true).order("nombre"),
      db.from("inventory_locations").select("id,name").eq("empresa_id", profile.empresa_id)
        .eq("location_type", "CENTRAL").eq("active", true).eq("is_primary", true).limit(1).maybeSingle(),
    ]);
    for (const result of [projects, products, central]) if (result.error) throw new Error(result.error.message);
    return { data: { projects: projects.data ?? [], products: products.data ?? [], central: central.data }, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "No se pudieron cargar los destinos de compra." };
  }
}

export async function uploadRfqAttachments(rfqId: string, files: File[]) {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const admin = createAdminClient();

  // admin client bypasses RLS — confirm the RFQ is in the caller's empresa.
  const { data: rfq } = await admin
    .from("rfqs")
    .select("id")
    .eq("id", rfqId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!rfq) return { error: "Solicitud no encontrada." };

  for (const file of files) {
    if (!file || file.size === 0) continue;
    if (file.size > MAX_FILE_BYTES) return { error: `${file.name}: no puede superar los 20MB.` };

    const path = `${rfqId}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage
      .from("rfq-attachments")
      .upload(path, file, { contentType: file.type || undefined });
    if (uploadError) return { error: `${file.name}: ${uploadError.message}` };

    const { error: attachmentError } = await admin.from("attachments").insert({
      empresa_id: profile.empresa_id,
      bucket: "rfq-attachments",
      path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: profile.id,
      rfq_id: rfqId,
    });
    if (attachmentError) return { error: `${file.name}: ${attachmentError.message}` };
  }

  revalidatePath(`/rfqs/${rfqId}`);
  return { error: null };
}

export async function createRfq(formData: FormData) {
  const profile = await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();

  const product = str(formData, "product");
  const quantity = Number(formData.get("quantity"));
  const unit = str(formData, "unit");
  const quoteType = formData.get("quote_type") === "COT" ? "COT" : "RFQ";

  if (!product || !unit || !Number.isFinite(quantity) || quantity <= 0) {
    return { error: "Completá producto, unidad y una cantidad válida.", id: null };
  }

  let data: { id:string };
  try {
    const itemsRaw=str(formData,"items");
    const items=itemsRaw ? JSON.parse(itemsRaw) : [{descripcion:product,cantidad:quantity,unidad:unit,producto_id:null}];
    const origin = str(formData,"need_origin");
    // A weekly need gets its project from the locked server snapshot. Manual
    // purchases choose a project, or the configured primary central location.
    if (!origin) {
      const destination = str(formData, "purchase_destination");
      if (destination && !["PROJECT", "CENTRAL"].includes(destination)) throw new Error("Destino de compra inválido.");
      if (destination === "PROJECT" && !str(formData, "project_id")) throw new Error("Elegí la obra de esta compra.");
      if (destination === "CENTRAL") {
        if (str(formData, "project_id")) throw new Error("La compra central no puede tener una obra asignada.");
        const central = await supabase.from("inventory_locations").select("id").eq("empresa_id", profile.empresa_id)
          .eq("location_type", "CENTRAL").eq("active", true).eq("is_primary", true).limit(1).maybeSingle();
        if (central.error) throw new Error(central.error.message);
        if (!central.data) throw new Error("Configurá un depósito central antes de comprar para ese destino.");
      }
    }
    if (origin) {
      data=await rpc<{id:string}>(supabase,"weekly_plan_need_rfq",{...needOriginArgs(JSON.parse(origin)),p_header:{specifications:str(formData,"specifications"),internal_reference:str(formData,"internal_reference"),observations:str(formData,"observations")}});
    } else data=await createCanonicalRfq(supabase,{purpose:str(formData,"purpose"),quote_type:quoteType,product,
      specifications:str(formData,"specifications"),required_date:str(formData,"required_date"),
      internal_reference:str(formData,"internal_reference"),observations:str(formData,"observations"),project_id:str(formData,"project_id")},items);
  } catch(e) { return {error:e instanceof Error?e.message:"RFQ inválida",id:null}; }

  revalidatePath("/rfqs");
  const projectId = str(formData, "project_id");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 0) {
    try {
      const uploadResult = await uploadRfqAttachments(data.id, files);
      if (uploadResult.error) return { error: `Solicitud creada, pero falló la subida del archivo: ${uploadResult.error}`, id: data.id };
    } catch (e) {
      return { error: `Solicitud creada, pero falló la subida del archivo: ${e instanceof Error ? e.message : "Error de carga"}`, id: data.id };
    }
  }

  return { error: null, id: data.id as string };
}
