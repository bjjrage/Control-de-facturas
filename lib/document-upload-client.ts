"use client";
import { createClient } from "@/lib/supabase/browser";
import { DOCUMENT_UPLOAD_BUCKET, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BATCH_BYTES, type DocumentUploadContext } from "./document-upload";

export async function uploadDirectDocument(file: File, context: DocumentUploadContext = { kind: "internal" }): Promise<string> {
  if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new Error(`${file.name}: el archivo debe tener entre 1 byte y 20 MiB.`);
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  const response = await fetch("/api/document-uploads", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, file: { name: file.name, type: file.type || "application/octet-stream", size: file.size, sha256 } }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "No se pudo autorizar la carga del archivo.");
  try {
    const uploaded = await createClient().storage.from(DOCUMENT_UPLOAD_BUCKET)
      .uploadToSignedUrl(result.path, result.token, file, { contentType: file.type || "application/octet-stream" });
    if (uploaded.error) throw new Error("No se pudo subir el archivo a Storage. Reintentá.");
    return result.reference;
  } catch (error) {
    await fetch("/api/document-uploads", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context, reference: result.reference }) }).catch(() => undefined);
    throw error;
  }
}
export async function prepareDirectUploadForm(form: FormData, context: DocumentUploadContext = { kind: "internal" }) {
  const entries = [...form.entries()];
  const files = entries.map(([, value]) => value).filter((v): v is File => v instanceof File && v.size > 0);
  if (files.length > 20 || files.reduce((sum, f) => sum + f.size, 0) > MAX_DOCUMENT_BATCH_BYTES) throw new Error("Adjuntá hasta 20 archivos y 50 MiB en total.");
  if (files.some(f => f.size > MAX_DOCUMENT_BYTES)) throw new Error("Cada archivo puede ocupar hasta 20 MiB.");
  const result = new FormData();
  try {
    for (const [name, value] of entries) {
      if (value instanceof File) {
        if (value.size > 0) result.append(name, await uploadDirectDocument(value, context));
      } else result.append(name, value);
    }
    return result;
  } catch (error) {
    for (const value of result.values()) {
      if (typeof value === "string" && value.startsWith("direct-upload:v1:")) {
        await fetch("/api/document-uploads", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context, reference: value }) }).catch(() => undefined);
      }
    }
    throw error;
  }
}
