import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashWarehousePortalToken, sha256Bytes } from "@/lib/inventory/portal";
import { sanitizeFileName } from "@/lib/storage";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 20;

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type RouteContext = { params: Promise<{ token: string }> };

async function resolveLink(token: string) {
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("warehouse_portal_links")
    .select("id, empresa_id, location_id, active, expires_at")
    .eq("token_hash", hashWarehousePortalToken(token))
    .maybeSingle();
  if (!link || !link.active || (link.expires_at && new Date(link.expires_at).getTime() <= Date.now())) return null;
  const { data: location } = await admin
    .from("inventory_locations")
    .select("id, name, project_id, location_type, active")
    .eq("id", link.location_id)
    .eq("empresa_id", link.empresa_id)
    .maybeSingle();
  if (!location || !location.active || location.location_type !== "PROJECT" || !location.project_id) return null;
  return { admin, link, location };
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveLink(token);
  if (!resolved) return NextResponse.json({ error: "Enlace inválido o vencido." }, { status: 404 });
  return NextResponse.json({ location: resolved.location.name, projectId: resolved.location.project_id });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const resolved = await resolveLink(token);
  if (!resolved) return NextResponse.json({ error: "Enlace inválido o vencido." }, { status: 404 });

  const formData = await request.formData();
  const periodStart = String(formData.get("period_start") ?? "").trim();
  const periodEnd = String(formData.get("period_end") ?? "").trim();
  if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodEnd < periodStart) {
    return NextResponse.json({ error: "El período no es válido." }, { status: 400 });
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0)
    .slice(0, MAX_FILES);
  if (!files.length) return NextResponse.json({ error: "Subí al menos una foto o planilla." }, { status: 400 });
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `${file.name}: el archivo supera los 20MB.` }, { status: 400 });
    }
  }

  const notes = String(formData.get("notes") ?? "").trim() || null;
  const remisionNumber = String(formData.get("remision_number") ?? "").trim() || null;
  const { admin, link, location } = resolved;

  let { data: submission, error: submissionError } = await admin
    .from("warehouse_submissions")
    .insert({
      empresa_id: link.empresa_id,
      location_id: link.location_id,
      project_id: location.project_id,
      portal_link_id: link.id,
      period_start: periodStart,
      period_end: periodEnd,
      remision_number: remisionNumber,
      notes,
      status: "UPLOADED",
    })
    .select("id, status")
    .single();
  if (submissionError) {
    const existing = await admin
      .from("warehouse_submissions")
      .select("id, status")
      .eq("empresa_id", link.empresa_id)
      .eq("location_id", link.location_id)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .maybeSingle();
    submission = existing.data;
    submissionError = existing.error;
  }
  if (submissionError || !submission) return NextResponse.json({ error: "No se pudo crear la rendición." }, { status: 409 });
  if (submission.status === "CONFIRMED" || submission.status === "VOIDED") {
    return NextResponse.json({ error: "El período ya está cerrado.", submissionId: submission.id }, { status: 409 });
  }

  let uploaded = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = sha256Bytes(bytes);
    const { data: existingEvidence } = await admin
      .from("warehouse_submission_evidence")
      .select("id")
      .eq("submission_id", submission.id)
      .eq("sha256", sha256)
      .maybeSingle();
    if (existingEvidence) {
      uploaded++;
      continue;
    }
    const path = `${link.location_id}/${submission.id}/${randomUUID()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await admin.storage.from("warehouse-evidence").upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (uploadError) continue;
    const { error: evidenceError } = await admin.from("warehouse_submission_evidence").insert({
      empresa_id: link.empresa_id,
      submission_id: submission.id,
      storage_bucket: "warehouse-evidence",
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      sha256,
      uploaded_external: true,
    });
    if (evidenceError) {
      const { data: duplicateAfterRace } = await admin
        .from("warehouse_submission_evidence")
        .select("id")
        .eq("submission_id", submission.id)
        .eq("sha256", sha256)
        .maybeSingle();
      await admin.storage.from("warehouse-evidence").remove([path]);
      if (duplicateAfterRace) uploaded++;
      continue;
    }
    uploaded++;
  }
  await admin
    .from("warehouse_portal_links")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", link.id)
    .eq("empresa_id", link.empresa_id);
  if (!uploaded) return NextResponse.json({ error: "No se pudo guardar la evidencia.", submissionId: submission.id }, { status: 500 });
  return NextResponse.json({ ok: true, submissionId: submission.id, uploaded });
}
