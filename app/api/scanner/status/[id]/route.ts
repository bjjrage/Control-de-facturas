import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSessionExpired } from '@/lib/scanner/tokens';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'ID de sesión requerido' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: session, error } = await admin
      .from('scan_sessions')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !session) {
      return NextResponse.json({ error: 'Sesión no encontrada' }, { status: 404 });
    }

    let currentStatus = session.status;
    if (isSessionExpired(session.expires_at) && currentStatus !== 'completed') {
      currentStatus = 'expired';
    }

    let signedUrl: string | null = null;
    if (currentStatus === 'completed' && session.storage_path) {
      const { data: signedData } = await admin.storage
        .from(session.storage_bucket || 'invoice-files')
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