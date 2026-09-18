import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/auth';
import { claimScanSession, getScanSessionByPin } from '@/lib/scanner/session-service';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, pin, deviceInfo } = body;

    const profile = await getCurrentProfile().catch(() => null);

    if (token) {
      const result = await claimScanSession(token, deviceInfo || {}, profile?.id);
      return NextResponse.json({
        success: true,
        session: {
          id: result.session.id,
          context_type: result.session.context_type,
          context_id: result.session.context_id,
          status: result.session.status,
          expires_at: result.session.expires_at,
          token: result.token,
        },
      });
    }

    if (pin) {
      const session = await getScanSessionByPin(pin);
      if (!session) {
        return NextResponse.json(
          { error: 'Código PIN inválido o sesión expirada' },
          { status: 404 }
        );
      }

      // Conectar la sesión
      const admin = createAdminClient();
      const { data: updated, error } = await admin
        .from('scan_sessions')
        .update({
          status: 'connected',
          claimed_by_user_id: profile?.id ?? null,
          claimed_device_info: deviceInfo || {},
        })
        .eq('id', session.id)
        .select()
        .single();

      if (error || !updated) {
        return NextResponse.json(
          { error: 'No se pudo conectar a la sesión' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        session: {
          id: updated.id,
          context_type: updated.context_type,
          context_id: updated.context_id,
          status: updated.status,
          expires_at: updated.expires_at,
          // Retornamos el token_hash como identificador de sesión por PIN si no vino token
          tokenHash: updated.token_hash,
        },
      });
    }

    return NextResponse.json(
      { error: 'Se requiere token o código PIN para conectar' },
      { status: 400 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al conectar con la sesión';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
