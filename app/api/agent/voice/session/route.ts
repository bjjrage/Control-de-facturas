// app/api/agent/voice/session/route.ts
// API route para crear una sesión de voz.
// Server-side only: valida autenticación y tenant, retorna sessionId y config.

import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { actorFromProfile, withWorkspace } from "@/lib/agent/context";
import { sanitizeAgentError } from "@/lib/agent/sanitize";
import { isVoiceAvailable } from "@/lib/voice/providers";
import { createVoiceSession } from "@/lib/voice/service";

export async function POST(request: NextRequest) {
  try {
    // 1. Verificar que voz esté disponible
    if (!isVoiceAvailable()) {
      return NextResponse.json(
        { error: "Voice unavailable", message: "DEEPGRAM_API_KEY no configurada" },
        { status: 503 }
      );
    }

    // 2. Autenticación y tenant
    const profile = await requireProfile();
    if (!profile.empresa_id) {
      return NextResponse.json(
        { error: "No tenant", message: "Usuario sin empresa asignada" },
        { status: 403 }
      );
    }

    // 3. Parsear body
    const body = await request.json().catch(() => ({}));
    const { workspace } = body as { workspace?: unknown }; // AgentWorkspaceContext del frontend

    // 4. Construir actor context con workspace
    const actor = actorFromProfile(profile, { source: "web" });
    const agentContext = withWorkspace(actor, workspace || null);

    // 5. Crear sesión de voz
    const session = await createVoiceSession(agentContext, {
      maxTurnDurationMs: body.maxTurnDurationMs,
      idleTimeoutMs: body.idleTimeoutMs,
      maxTtsChars: body.maxTtsChars,
      stt: body.sttConfig,
      tts: body.ttsConfig,
    });

    // 6. Retornar sessionId y config para el cliente
    return NextResponse.json({
      sessionId: session.sessionId,
      state: session.state,
      config: {
        maxTurnDurationMs: session.config.maxTurnDurationMs,
        idleTimeoutMs: session.config.idleTimeoutMs,
        maxTtsChars: session.config.maxTtsChars,
        stt: session.config.stt,
        tts: session.config.tts,
      },
      context: {
        empresaId: session.context.empresaId,
        userId: session.context.userId,
        role: session.context.role,
        projectId: session.context.projectId,
        taskId: session.context.taskId,
        runId: session.context.runId,
        workspace: session.context.workspace,
      },
    });
  } catch (error) {
    console.error("[Voice API] Error creating session:", sanitizeAgentError(error));
    return NextResponse.json(
      { error: "Internal error", message: "No se pudo crear la sesión de voz" },
      { status: 500 }
    );
  }
}
