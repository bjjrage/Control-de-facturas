import { NextRequest, NextResponse } from 'next/server';
import { getScanSessionByCredential } from '@/lib/scanner/session-service';
import { isSessionExpired } from '@/lib/scanner/tokens';
import {
  clearMobileCredentialCookie,
  getMobileCredentialFromRequest,
  setMobileCredentialCookie,
} from '@/lib/scanner/cookies';

/**
 * GET /api/scanner/mobile-session
 * Endpoint de resume para reanudar sesiones activas en el dispositivo móvil tras refresco de página.
 */
export async function GET(req: NextRequest) {
  try {
    const cred = getMobileCredentialFromRequest(req);
    if (!cred || !cred.mobileClaimToken) {
      return NextResponse.json({ active: false, session: null }, { status: 200 });
    }

    let session = await getScanSessionByCredential(cred.mobileClaimToken);

    // Si no se encontró por hash (por ejemplo si ya fue completada y se limpió mobile_claim_token_hash)
    // verificar si la sesión existe por id y está completada/cancelada
    if (!session && cred.sessionId) {
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const admin = createAdminClient();
      const { data: byId } = await admin
        .from('scan_sessions')
        .select('*')
        .eq('id', cred.sessionId)
        .maybeSingle();

      if (byId && (byId.status === 'completed' || byId.status === 'canceled')) {
        session = byId;
      }
    }

    if (!session || (cred.sessionId && session.id !== cred.sessionId)) {
      const res = NextResponse.json(
        { active: false, session: null, error: 'Credencial inválida o sesión no encontrada' },
        { status: 401 }
      );
      clearMobileCredentialCookie(res);
      return res;
    }

    // Validar expiración
    if (isSessionExpired(session.expires_at) || session.status === 'expired') {
      const res = NextResponse.json(
        { active: false, status: 'expired', error: 'La sesión ha expirado' },
        { status: 410 }
      );
      clearMobileCredentialCookie(res);
      return res;
    }

    // Validar si ya fue completada o cancelada
    if (session.status === 'completed' || session.status === 'canceled') {
      const res = NextResponse.json(
        { active: false, status: session.status, message: 'La sesión ya fue finalizada' },
        { status: 200 }
      );
      clearMobileCredentialCookie(res);
      return res;
    }

    // Sesión activa válida ('waiting', 'connected', 'scanning', 'processing')
    const res = NextResponse.json({
      active: true,
      session: {
        id: session.id,
        context_type: session.context_type,
        context_id: session.context_id,
        status: session.status,
        expires_at: session.expires_at,
      },
      mobileClaimToken: cred.mobileClaimToken,
    });

    // Reafirmar cookie con tiempo restante
    setMobileCredentialCookie(res, session.id, cred.mobileClaimToken, session.expires_at);
    return res;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al verificar sesión móvil';
    return NextResponse.json({ active: false, error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/scanner/mobile-session
 * Cierra voluntariamente la sesión móvil y destruye la cookie HttpOnly.
 */
export async function DELETE() {
  const res = NextResponse.json({ success: true, message: 'Sesión móvil desconectada' });
  clearMobileCredentialCookie(res);
  return res;
}
