import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/auth';
import { claimScanSession } from '@/lib/scanner/session-service';
import {
  getMobileCredentialFromRequest,
  setMobileCredentialCookie,
} from '@/lib/scanner/cookies';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, pin, deviceInfo } = body;

    // Verificar si el dispositivo ya cuenta con una credencial previa (en cookie o body)
    const existingCred = getMobileCredentialFromRequest(req);
    const mobileClaimToken = body.mobileClaimToken || existingCred?.mobileClaimToken;

    if (!token && !pin) {
      return NextResponse.json(
        { error: 'Se requiere token o código PIN para conectar' },
        { status: 400 }
      );
    }

    const profile = await getCurrentProfile().catch(() => null);

    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      'client';

    const mergedDeviceInfo = {
      ...(deviceInfo || {}),
      ip: clientIp,
    };

    const result = await claimScanSession(
      { token, pin, mobileClaimToken },
      mergedDeviceInfo,
      profile?.id
    );

    // Responder con la sesión y credencial autorizada para el móvil
    const response = NextResponse.json({
      success: true,
      session: {
        id: result.session.id,
        context_type: result.session.context_type,
        context_id: result.session.context_id,
        status: result.session.status,
        expires_at: result.session.expires_at,
      },
      mobileClaimToken: result.mobileClaimToken,
    });

    // Guardar credencial móvil en cookie HttpOnly segura
    if (result.mobileClaimToken) {
      setMobileCredentialCookie(
        response,
        result.session.id,
        result.mobileClaimToken,
        result.session.expires_at
      );
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al conectar con la sesión';
    const isLocked = message.includes('Demasiados intentos fallidos') || message.includes('bloqueada');
    const isConflict =
      message.includes('Conflicto de concurrencia') ||
      message.includes('ya fue reclamada') ||
      message.includes('ya reclamada');

    const status = isLocked ? 429 : isConflict ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
