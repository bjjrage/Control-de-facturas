import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/auth';
import { createScanSession } from '@/lib/scanner/session-service';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const profile = await getCurrentProfile();
    if (!profile || !profile.empresa_id || !profile.active || (!profile.empresa_active && !profile.is_super_admin)) {
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

/** Cancel only the active session owned by the current ERP user. */
export async function DELETE(req: NextRequest) {
  const profile = await getCurrentProfile().catch(() => null);
  if (!profile?.empresa_id || !profile.active || (!profile.empresa_active && !profile.is_super_admin)) {
    return NextResponse.json({ error: 'Se requiere una sesión activa en el ERP.' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (typeof body?.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.sessionId)) {
    return NextResponse.json({ error: 'Sesión de escaneo inválida.' }, { status: 400 });
  }
  const admin = createAdminClient();
  const owned = () => admin.from('scan_sessions').select('id,status').eq('id',body.sessionId).eq('empresa_id',profile.empresa_id).eq('created_by',profile.id).maybeSingle();
  const before = await owned();
  if (before.error) return NextResponse.json({ error: 'No se pudo revisar la sesión.' }, { status: 503 });
  if (!before.data) return NextResponse.json({ error: 'Sesión no encontrada.' }, { status: 404 });
  const result = await admin.from('scan_sessions').update({ status: 'canceled', mobile_claim_token_hash: null,
    token_hash: 'CANCELED:' + before.data.id, pin_code: 'RETIRED:' + before.data.id, expires_at: new Date().toISOString() })
    .eq('id',before.data.id).eq('empresa_id',profile.empresa_id).eq('created_by',profile.id)
    .in('status',['waiting','connected','scanning','processing']);
  if (result.error) return NextResponse.json({ error: 'No se pudo cancelar la sesión. Reintentá.' }, { status: 503 });
  return NextResponse.json({ ok: true });
}
