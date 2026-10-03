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
    if (origin) {
      data=await rpc<{id:string}>(supabase,"weekly_plan_need_rfq",{...needOriginArgs(JSON.parse(origin)),p_header:{specifications:str(formData,"specifications"),internal_reference:str(formData,"internal_reference"),observations:str(formData,"observations")}});
    } else data=await createCanonicalRfq(supabase,{purpose:str(formData,"purpose"),quote_type:quoteType,product,
      specifications:str(formData,"specifications"),required_date:str(formData,"required_date"),
      internal_reference:str(formData,"internal_reference"),observations:str(formData,"observations"),project_id:str(formData,"project_id")},items);
  } catch(e) { return {error:e instanceof Error?e.message:"RFQ inválida",id:null}; }

  const files = formData.getAll("attachments").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > 0) {
    const uploadResult = await uploadRfqAttachments(data.id, files);
    if (uploadResult.error) {
      revalidatePath("/rfqs");
      return { error: `Solicitud creada, pero falló la subida del archivo: ${uploadResult.error}`, id: data.id as string };
    }
  }

  revalidatePath("/rfqs");
  const projectId = str(formData, "project_id");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return { error: null, id: data.id as string };
}
