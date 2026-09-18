// app/api/agent/voice/transcribe/route.ts
// STT server-side para Rodrigo V1: recibe audio grabado con MediaRecorder
// (cross-browser, sin Web Speech API) y lo transcribe con OpenAI
// gpt-transcribe. La OPENAI_API_KEY nunca sale del servidor: el browser solo
// hace POST del audio a este endpoint. Sin TTS, sin persistencia de audio.

import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8 MB server-side
const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const TRANSCRIBE_MODEL = "gpt-transcribe";
const TRANSCRIBE_LANGUAGE = "es";
const TRANSCRIBE_PROMPT =
  "ERP de construcción en Paraguay. Español paraguayo. " +
  "Términos frecuentes: obra, presupuesto, hormigón, licitación, DNCP, " +
  "orden de compra, proveedor, stock, planilla, certificación, APU, BIM, factura.";

// MIME base permitidos (se compara sin parámetros ;codecs=...). Son los que
// producen MediaRecorder en Firefox/Chrome/Edge, más mp4/mpeg/wav robustos.
const ALLOWED_AUDIO_BASE = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);

function extForMime(base: string): string {
  if (base === "audio/ogg") return "audio.ogg";
  if (base === "audio/mp4") return "audio.mp4";
  if (base === "audio/mpeg") return "audio.mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "audio.wav";
  return "audio.webm";
}

function noStoreJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  let profile;
  try {
    profile = await requireProfile();
    if (!profile?.empresa_id) return noStoreJson({ error: "Unauthorized" }, 401);
  } catch {
    return noStoreJson({ error: "Unauthorized" }, 401);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return noStoreJson({ error: "Transcription unavailable" }, 503);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return noStoreJson({ error: "No se pudo leer el audio." }, 400);
  }
  const entry = form.get("audio");
  if (!entry || typeof entry === "string") {
    return noStoreJson({ error: "Falta el archivo de audio." }, 400);
  }
  const audio = entry as Blob;
  if (audio.size === 0) {
    return noStoreJson({ error: "No se detectó audio. Probá de nuevo." }, 400);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return noStoreJson({ error: "El audio superó el límite. Probá con un mensaje más corto." }, 413);
  }
  const fullType = (audio.type || "").trim();
  const baseType = fullType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_AUDIO_BASE.has(baseType)) {
    return noStoreJson({ error: "Formato de audio no soportado." }, 415);
  }

  const outbound = new FormData();
  outbound.append("file", audio, extForMime(baseType));
  outbound.append("model", TRANSCRIBE_MODEL);
  outbound.append("language", TRANSCRIBE_LANGUAGE);
  outbound.append("prompt", TRANSCRIBE_PROMPT);
  outbound.append("response_format", "json");

  let upstream: Response;
  try {
    upstream = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outbound,
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return noStoreJson({ error: "No pude transcribir el audio. Probá de nuevo." }, 502);
  }
  if (!upstream.ok) {
    console.error("[voice/transcribe] OpenAI transcription failed", upstream.status);
    return noStoreJson({ error: "No pude transcribir el audio. Probá de nuevo." }, 502);
  }
  const payload = (await upstream.json().catch(() => ({}))) as { text?: unknown };
  const transcript = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!transcript) {
    return noStoreJson({ error: "No se detectó voz en el audio. Probá de nuevo." }, 422);
  }
  return noStoreJson({ transcript });
}
