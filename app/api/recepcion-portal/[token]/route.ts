import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getReceiptPortalContext } from "@/lib/inventory/receipt-portal-data";
import {
  hashReceiptPortalToken,
  isReceiptPortalDate,
  isReceiptPortalEvidenceSignature,
  validateReceiptPortalLines,
} from "@/lib/inventory/receipt-portal";
import { sha256Bytes } from "@/lib/inventory/portal";
import { sanitizeFileName } from "@/lib/storage";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 50 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);
type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const portal = await getReceiptPortalContext(token);
  if (!portal) {
    return NextResponse.json({ error: "Enlace inválido o vencido." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "El formulario enviado no es válido." }, { status: 400 });
  }
  const fecha = String(form.get("fecha") ?? "").trim();
  const recibidoPor = String(form.get("recibido_por") ?? "").trim();
  const remisionNumber = String(form.get("remision_number") ?? "").trim();
  const notas = String(form.get("notas") ?? "").trim();
  if (!isReceiptPortalDate(fecha) || recibidoPor.length < 1 || recibidoPor.length > 120 || remisionNumber.length > 100 || notas.length > 2000) {
    return NextResponse.json({ error: "Revisá la fecha y los datos del formulario." }, { status: 400 });
  }

  let rawItems: unknown;
  try {
    rawItems = JSON.parse(String(form.get("items") ?? ""));
  } catch {
    return NextResponse.json({ error: "Indicá al menos una cantidad recibida válida." }, { status: 400 });
  }
  const pendingByItemId = new Map(portal.order.items.map((item) => [item.id, item.pending]));
  const items = validateReceiptPortalLines(rawItems, pendingByItemId);
  if (!items) return NextResponse.json({ error: "Hay cantidades inválidas o superiores a lo pendiente." }, { status: 400 });

  const files = form.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
  if (files.length === 0 || files.length > MAX_FILES) {
    return NextResponse.json({ error: "Adjuntá entre 1 y 10 archivos de evidencia." }, { status: 400 });
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_FILE_BYTES) {
    return NextResponse.json({ error: "La evidencia no puede superar 50 MB en total." }, { status: 400 });
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES || !ACCEPTED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ error: `${file.name}: tipo de archivo no permitido o supera los 20 MB.` }, { status: 400 });
    }
  }

  const uploadedPaths: string[] = [];
  const evidence: Array<{
    storage_bucket: string;
    storage_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  }> = [];
  const seenHashes = new Set<string>();
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isReceiptPortalEvidenceSignature(bytes, file.type)) {
      if (uploadedPaths.length) await portal.admin.storage.from("warehouse-evidence").remove(uploadedPaths);
      return NextResponse.json({ error: "El contenido de un archivo no coincide con su tipo declarado." }, { status: 400 });
    }
    const sha256 = sha256Bytes(bytes);
    if (seenHashes.has(sha256)) continue;
    const storagePath = `receipt-portals/${portal.link.id}/${randomUUID()}-${sanitizeFileName(file.name)}`;
    const { error } = await portal.admin.storage.from("warehouse-evidence").upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      if (uploadedPaths.length) await portal.admin.storage.from("warehouse-evidence").remove(uploadedPaths);
      return NextResponse.json({ error: "No se pudo guardar toda la evidencia. No se creó la recepción; intentá nuevamente." }, { status: 502 });
    }
    uploadedPaths.push(storagePath);
    seenHashes.add(sha256);
    evidence.push({
      storage_bucket: "warehouse-evidence",
      storage_path: storagePath,
      file_name: sanitizeFileName(file.name).slice(0, 255),
      mime_type: file.type,
      size_bytes: file.size,
      sha256,
    });
  }

  const { data: receiptId, error } = await portal.admin.rpc("submit_receipt_portal", {
    p_token_hash: hashReceiptPortalToken(token),
    p_fecha: fecha,
    p_recibido_por: recibidoPor,
    p_remision_number: remisionNumber || null,
    p_notas: notas || null,
    p_items: items,
    p_evidence: evidence,
  });
  if (error || !receiptId) {
    if (uploadedPaths.length) await portal.admin.storage.from("warehouse-evidence").remove(uploadedPaths);
    return NextResponse.json({
      error: "No se pudo registrar: el enlace venció, ya fue usado o cambiaron las cantidades pendientes. Solicitá un enlace actualizado.",
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json({ receiptId }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
