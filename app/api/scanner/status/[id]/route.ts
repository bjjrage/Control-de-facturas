import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSessionExpired } from '@/lib/scanner/tokens';
import { canReadScannerContext, isScannerObjectReferenceValid, SCANNER_STORAGE_BUCKET } from '@/lib/scanner/session-access';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Autorización obligatoria: sólo usuarios autenticados del ERP
    const profile = await getCurrentProfile().catch(() => null);
    if (!profile || !profile.empresa_id || !profile.active || (!profile.empresa_active && !profile.is_super_admin)) {
      return NextResponse.json(
        { error: 'No autorizado. Se requiere sesión activa en el ERP.' },
        { status: 401 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'ID de sesión requerido' }, { status: 400 });
    }

    // 2. Aislamiento estricto por tenant: la consulta DEBE estar restringida a profile.empresa_id
    const admin = createAdminClient();
    const { data: session, error } = await admin
      .from('scan_sessions')
      .select('id, empresa_id, created_by, status, context_type, context_id, target_field, file_name, file_size_bytes, page_count, storage_path, storage_bucket, expires_at, completed_at')
      .eq('id', id)
      .eq('empresa_id', profile.empresa_id) // Tenant isolation fail-closed
      .eq('created_by', profile.id)
      .maybeSingle();

    // Si no existe o pertenece a otra empresa -> 404 fail-closed
    if (error || !session) {
      return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
    }

    if (session.created_by !== profile.id || !canReadScannerContext(profile.role, session.context_type)) {
      return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
    }

    let currentStatus = session.status;
    if (isSessionExpired(session.expires_at) && currentStatus !== 'completed' && currentStatus !== 'canceled') {
      currentStatus = 'expired';
    }

    // 3. Generar URL firmada temporal (300s) ÚNICAMENTE si la sesión está completada
    let signedUrl: string | null = null;
    if (currentStatus === 'completed') {
      if (!isScannerObjectReferenceValid(session)) {
        return NextResponse.json({ error: 'Referencia de almacenamiento de sesión no válida.' }, { status: 409 });
      }
      const { data: signedData } = await admin.storage
        .from(SCANNER_STORAGE_BUCKET)
        .createSignedUrl(session.storage_path, 300);
      signedUrl = signedData?.signedUrl ?? null;
    }

    return NextResponse.json({
      id: session.id,
      status: currentStatus,
      context_type: session.context_type,
      context_id: session.context_id,
      target_field: session.target_field,
      file_name: session.file_name,
      file_size_bytes: session.file_size_bytes,
      page_count: session.page_count,
      storage_path: session.storage_path,
      signed_url: signedUrl,
      completed_at: session.completed_at,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error al consultar estado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
