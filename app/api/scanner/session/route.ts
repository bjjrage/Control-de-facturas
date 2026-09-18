import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/auth';
import { createScanSession } from '@/lib/scanner/session-service';

export async function POST(req: NextRequest) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || !profile.empresa_id) {
      return NextResponse.json(
        { error: 'No autorizado. Debe iniciar sesión en el ERP.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { contextType, contextId, targetField, metadata, ttlMinutes } = body;

    const result = await createScanSession(profile.empresa_id, profile.id, {
      contextType: contextType || 'general',
      contextId,
      targetField,
      metadata,
      ttlMinutes: ttlMinutes || 15,
    });

    return NextResponse.json({
      success: true,
      sessionId: result.session.id,
      token: result.token,
      pinCode: result.session.pin_code,
      expiresAt: result.session.expires_at,
      status: result.session.status,
      joinUrl: result.joinUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno al crear sesión';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
