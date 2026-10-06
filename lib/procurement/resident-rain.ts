import { createHash } from "node:crypto";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attachLocalPrecipitation } from "./climate-workdays";
import { locateLocalClimateEvent, proposeResidentWorkday, validClimateDate } from "./climate-entry";

export async function registerResidentRain(db: SupabaseClient, token: string, form: FormData): Promise<{ error: string | null }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return { error: "Enlace inválido." };
  const { data: project, error } = await db.from("projects").select("id,status,start_date,precipitation_threshold_mm").eq("execution_token", token).maybeSingle();
  if (error || !project || project.status !== "ACTIVO") return { error: "Enlace inválido o la obra no está activa." };
  // Browser-supplied context is never authority, including accidental/malicious cross-project IDs.
  if (["project_id", "empresa_id", "climate_event_id", "workday_status_id", "decision_status"].some(key => form.has(key))) return { error: "El contexto de la obra se obtiene del enlace." };
  const date = String(form.get("date") ?? "");
  const rawMm = form.get("precipitation_mm");
  const mm = Number(rawMm);
  if (!validClimateDate(date, project.start_date)) return { error: "Fecha inválida, futura o anterior al inicio de obra." };
  if (typeof rawMm !== "string" || !rawMm.trim() || !Number.isFinite(mm) || mm < 0 || mm >= 1e6) return { error: "La medición debe ser mayor o igual a cero." };
  const photos = form.getAll("photo");
  const photo = photos[0];
  if (photos.length !== 1 || !(photo instanceof File) || photo.size <= 0 || photo.size > 6 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(photo.type)) return { error: "Adjuntá una foto del pluviómetro (JPG, PNG o WebP, hasta 6 MB)." };
  const bytes = Buffer.from(await photo.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp = bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (!((photo.type === "image/jpeg" && jpeg) || (photo.type === "image/png" && png) || (photo.type === "image/webp" && webp))) return { error: "El archivo no corresponde a una imagen válida." };
  try {
    const image = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!image.width || !image.height || (image.pages ?? 1) !== 1) return { error: "Adjuntá una foto estática válida." };
  } catch { return { error: "No se pudo leer la imagen del pluviómetro." }; }
  const notes = String(form.get("notes") ?? "").trim();
  if (notes.length > 500) return { error: "La nota admite hasta 500 caracteres." };
  // Content + payload identity survives refresh/retry. Never upsert immutable physical evidence.
  const digest = createHash("sha256").update(JSON.stringify([date, mm, notes])).update(bytes).digest("hex");
  const path = `${project.id}/climate/resident/${date}/${digest}.${jpeg ? "jpg" : png ? "png" : "webp"}`;
  try {
    const readEvidence = () => db.from("climate_evidence").select("id,climate_event_id,evidence_type").eq("project_id", project.id).eq("storage_path", path).maybeSingle();
    const prior = await readEvidence();
    if (prior.error) throw new Error("No se pudo comprobar el reporte.");
    if (!prior.data) {
      const uploaded = await db.storage.from("execution-photos").upload(path, bytes, { contentType: photo.type, upsert: false });
      if (uploaded.error && !["409","Duplicate"].includes(String(uploaded.error.statusCode)) && !/already exists/i.test(uploaded.error.message)) throw new Error("No se pudo guardar la foto. Reintentá el mismo reporte.");
    }
    const threshold = Number(project.precipitation_threshold_mm ?? 15);
    const event = await locateLocalClimateEvent(db, project.id, date, threshold);
    let existingEvidence = prior.data;
    if (!existingEvidence) {
      // Evidence must exist before any resident measurement or workday proposal.
      // Only event linkage: an existing workday may legitimately reference another causal event.
      const evidence = await db.from("climate_evidence").insert({ project_id: project.id, climate_event_id: event.id, evidence_type: "RAIN_GAUGE_PHOTO", storage_bucket: "execution-photos", storage_path: path, file_name: `pluviometro-${date}`, mime_type: photo.type, size_bytes: bytes.length, metadata: { submitted_by_portal: true, precipitation_mm: mm, notes: notes || null } });
      if (evidence.error) {
        if (evidence.error.code !== "23505") throw new Error("No se pudo registrar la evidencia de la foto. Reintentá el mismo reporte.");
        const concurrent = await readEvidence();
        if (concurrent.error || !concurrent.data) throw new Error("No se pudo comprobar la evidencia de la foto. Reintentá el mismo reporte.");
        existingEvidence = concurrent.data;
      }
    }
    if (existingEvidence && (existingEvidence.climate_event_id !== event.id || existingEvidence.evidence_type !== "RAIN_GAUGE_PHOTO")) throw new Error("La evidencia no corresponde a este reporte.");
    // Immutable evidence is not a completion marker: retries resume both canonical writes.
    const saved = await attachLocalPrecipitation(db, project.id, event.id, mm);
    await proposeResidentWorkday(db, project.id, date, event.id, mm, Number(saved.contract_threshold_mm ?? threshold), notes || null);
    return { error: null };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "No se pudo registrar la lluvia." };
  }
}
