// server/voice-ws-proxy.ts
// WebSocket Proxy Server para Deepgram STT
// Corre en puerto separado (ej: 3001) junto a Next.js
// Proxy seguro: browser → este proxy → Deepgram

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { parse } from "url";
import { DeepgramSttProvider } from "../lib/voice/providers/deepgram-stt";

const PORT = process.env.VOICE_WS_PORT ? parseInt(process.env.VOICE_WS_PORT) : 3001;
// El guard de arranque (exit 1) garantiza presencia; el cast solo lo expresa al tipado.
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY as string;

if (!DEEPGRAM_API_KEY) {
  console.error("[Voice WS Proxy] DEEPGRAM_API_KEY no configurada");
  process.exit(1);
}

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

interface ClientSession {
  ws: WebSocket;
  sttProvider: any;
  sttSession: any;
  sessionId: string;
  empresaId: string;
  userId: string;
  abortController: AbortController;
  isProcessing: boolean;
  finalTranscriptReceived: boolean;
  transcriptBuffer: string;
}

const sessions = new Map<WebSocket, ClientSession>();

async function createSttSession(provider: any, config: any) {
  return await provider.createStreamingSession(config);
}

function generateSessionId(): string {
  return `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function authenticateConnection(req: any): { empresaId: string; userId: string } | null {
  // TODO: Implementar autenticación real (cookies, JWT, etc.)
  // Por ahora, leer de query params para desarrollo
  const url = new URL(req.url, `http://localhost:${process.env.PORT || 3000}`);
  const empresaId = url.searchParams.get("empresaId");
  const userId = url.searchParams.get("userId");
  
  if (!empresaId || !userId) {
    return null;
  }
  return { empresaId, userId };
}

wss.on("connection", async (ws: WebSocket, req) => {
  console.log("[Voice WS] Nueva conexión:", req.socket.remoteAddress);

  const auth = authenticateConnection(req);
  if (!auth) {
    ws.close(4001, "Unauthorized: empresaId y userId requeridos");
    return;
  }

  const sessionId = generateSessionId();
  const abortController = new AbortController();

  const session: ClientSession = {
    ws,
    sttProvider: null,
    sttSession: null,
    sessionId,
    empresaId: auth.empresaId,
    userId: auth.userId,
    abortController,
    isProcessing: false,
    finalTranscriptReceived: false,
    transcriptBuffer: "",
  };

  sessions.set(ws, session);

  // Enviar sessionId al cliente
  ws.send(JSON.stringify({ type: "session_created", sessionId }));

  ws.on("message", async (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(ws, session, message);
    } catch (error) {
      console.error("[Voice WS] Error procesando mensaje:", error);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    console.log("[Voice WS] Conexión cerrada:", sessionId);
    cleanupSession(session);
    sessions.delete(ws);
  });

  ws.on("error", (error) => {
    console.error("[Voice WS] Error en WebSocket:", error);
    cleanupSession(session);
    sessions.delete(ws);
  });
});

async function handleMessage(ws: WebSocket, session: ClientSession, message: any) {
  switch (message.type) {
    case "start_session": {
      if (session.sttSession) {
        ws.send(JSON.stringify({ type: "error", message: "Session already started" }));
        return;
      }

      try {
        // Crear proveedor STT
        const { DeepgramSttProvider } = await import("../lib/voice/providers/deepgram-stt");
        const sttProvider = new DeepgramSttProvider({ apiKey: DEEPGRAM_API_KEY });
        
        const sttSession = await sttProvider.createStreamingSession({
          language: message.config?.language || "es-PY",
          interimResults: true,
          punctuate: true,
          smartFormat: true,
          encoding: "linear16",
          sampleRate: 16000,
        });

        session.sttProvider = sttProvider;
        session.sttSession = sttSession;
        session.isProcessing = true;
        session.finalTranscriptReceived = false;
        session.transcriptBuffer = "";

        // Setup transcript handler
        const unsubTranscript = sttSession.onTranscript?.((result: any) => {
          if (result.isFinal) {
            session.finalTranscriptReceived = true;
            session.transcriptBuffer = result.text;
            ws.send(JSON.stringify({
              type: "transcript",
              text: result.text,
              isFinal: true,
              confidence: result.confidence,
            }));
          } else {
            ws.send(JSON.stringify({
              type: "transcript",
              text: result.text,
              isFinal: false,
            }));
          }
        });

        const unsubState = sttSession.onStateChange?.((state: string) => {
          ws.send(JSON.stringify({ type: "state", state }));
        });

        const unsubError = sttSession.onError?.((error: Error) => {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        });

        // Guardar cleanup functions
        (session as any).unsubTranscript = unsubTranscript;
        (session as any).unsubState = unsubState;
        (session as any).unsubError = unsubError;

        ws.send(JSON.stringify({ type: "session_started", sessionId: session.sessionId }));
        console.log("[Voice WS] STT session started:", session.sessionId);

      } catch (error) {
        console.error("[Voice WS] Error starting STT session:", error);
        const detail = error instanceof Error ? error.message : String(error);
        ws.send(JSON.stringify({ type: "error", message: `Failed to start STT: ${detail}` }));
      }
      break;
    }

    case "audio": {
      if (!session.sttSession || !session.isProcessing) {
        ws.send(JSON.stringify({ type: "error", message: "No active STT session" }));
        return;
      }

      // message.data es base64 encoded ArrayBuffer
      try {
        const audioBuffer = Buffer.from(message.data, "base64");
        await session.sttSession.sendAudio(audioBuffer);
      } catch (error) {
        console.error("[Voice WS] Error sending audio:", error);
        ws.send(JSON.stringify({ type: "error", message: "Failed to send audio" }));
      }
      break;
    }

    case "end_turn": {
      if (!session.sttSession || !session.isProcessing) {
        ws.send(JSON.stringify({ type: "error", message: "No active STT session" }));
        return;
      }

      try {
        await session.sttSession.endTurn();
        
        // Esperar transcript final
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        if (!session.finalTranscriptReceived && session.transcriptBuffer) {
          // Ya tenemos el transcript en buffer
        }
        
        ws.send(JSON.stringify({ type: "turn_ended" }));
      } catch (error) {
        console.error("[Voice WS] Error ending turn:", error);
        ws.send(JSON.stringify({ type: "error", message: "Failed to end turn" }));
      }
      break;
    }

    case "barge_in": {
      // Cancelar TTS y STT actual
      if (session.sttSession) {
        try {
          await session.sttSession.interrupt();
        } catch (e) {
          console.error("[Voice WS] Error interrupting STT:", e);
        }
      }
      
      // Notificar al orchestrator para cancelar TTS
      ws.send(JSON.stringify({ type: "barge_in_ack" }));
      session.isProcessing = false;
      break;
    }

    case "config": {
      // Actualizar config si no hay sesión activa
      if (!session.sttSession) {
        ws.send(JSON.stringify({ type: "config_ack" }));
      }
      break;
    }

    default:
      ws.send(JSON.stringify({ type: "error", message: `Unknown message type: ${message.type}` }));
  }
}

function cleanupSession(session: ClientSession) {
  if (session.sttSession) {
    try {
      session.sttSession.close?.();
    } catch (e) {
      console.error("[Voice WS] Error closing STT session:", e);
    }
  }
  if (session.sttProvider) {
    session.sttProvider.close?.().catch(() => {});
  }
  session.abortController.abort();
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[Voice WS] Shutting down...");
  for (const session of sessions.values()) {
    cleanupSession(session);
  }
  wss.close();
  process.exit(0);
});

httpServer.listen(PORT, () => {
  console.log(`[Voice WS Proxy] Listening on port ${PORT}`);
  console.log(`[Voice WS Proxy] Deepgram API Key: ${DEEPGRAM_API_KEY ? "SET" : "NOT SET"}`);
});