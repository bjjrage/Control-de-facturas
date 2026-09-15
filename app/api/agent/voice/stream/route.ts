// app/api/agent/voice/stream/route.ts
// WebSocket endpoint para streaming de voz (STT + TTS).
// Maneja: audio upload, STT, orchestrator, TTS, barge-in.

import { NextRequest, NextResponse } from "next/server";
import { WebSocket } from "ws";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile, withWorkspace } from "@/lib/agent/context";
import { createVoiceSession, runVoiceTurn, sanitizeForTts, logVoiceMetrics } from "@/lib/voice/service";
import { getSttProvider, getTtsProvider, isVoiceAvailable } from "@/lib/voice/providers";
import { sanitizeForTts as sanitizeTts } from "@/lib/voice/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Verificar upgrade a WebSocket
  const upgradeHeader = request.headers.get("upgrade");
  if (upgradeHeader !== "websocket") {
    return NextResponse.json(
      { error: "Expected WebSocket upgrade" },
      { status: 400 }
    );
  }

  // En Next.js App Router, el upgrade a WebSocket requiere un enfoque diferente
  // Usamos la API nativa de WebSocket si está disponible, o respondemos con error
  return NextResponse.json(
    { error: "WebSocket endpoint - use dedicated WebSocket server or Next.js custom server" },
    { status: 501 }
  );
}

// NOTA: En Next.js App Router, los WebSockets requieren un servidor personalizado
// o usar el edge runtime con upgrade. Para producción, se recomienda:
// 1. Usar un servidor WebSocket dedicado (ej: Socket.io server, ws library)
// 2. O usar el edge runtime con `export const runtime = 'edge'` y handle upgrade
// 3. O usar un servicio como Pusher, Ably, o Deepgram's propio WebSocket proxy

// Este endpoint es un placeholder que documenta el protocolo esperado:

/*
PROTOCOLO WEBSOCKET ESPERADO:

CLIENT -> SERVER:
{
  "type": "audio",
  "data": "<base64 encoded ArrayBuffer>",
  "sampleRate": 16000,
  "encoding": "linear16"
}

CLIENT -> SERVER (control):
{
  "type": "end_turn"
}
{
  "type": "barge_in"
}
{
  "type": "config",
  "stt": { ... },
  "tts": { ... }
}

SERVER -> CLIENT:
{
  "type": "state",
  "state": "LISTENING" | "TRANSCRIBING" | "THINKING" | "SPEAKING" | "IDLE" | "ERROR"
}
{
  "type": "transcript",
  "text": "texto transcrito",
  "isFinal": true,
  "confidence": 0.95
}
{
  "type": "transcript",
  "text": "texto parcial...",
  "isFinal": false
}
{
  "type": "agent_response",
  "text": "Respuesta del agente",
  "toolsUsed": ["get_project_context", "create_rfq_draft"]
}
{
  "type": "audio",
  "data": "<base64 encoded audio chunk>",
  "format": "linear16",
  "sampleRate": 16000
}
{
  "type": "error",
  "code": "STT_FAILED",
  "message": "Error message"
}
{
  "type": "metrics",
  "sttAudioSeconds": 5.2,
  "ttsCharacters": 150,
  "durationMs": 3400
}
*/