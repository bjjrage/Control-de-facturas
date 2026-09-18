import { NextRequest, NextResponse } from 'next/server';
import { getScanSessionByToken, completeScanSession } from '@/lib/scanner/session-service';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeFileName } from '@/lib/storage';

const MAX_SCAN_BYTES = 20 * 1024 * 1024; // 20MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const token = formData.get('token') as string | null;
    const tokenHash = formData.get('tokenHash') as string | null;
    const file = formData.get('file') as File | null;
    const pageCountStr = formData.get('pageCount') as string | null;
    const pageCount = pageCountStr ? parseInt(pageCountStr, 10) : 1;

    if (!file) {
      return NextResponse.json({ error: 'No se envió ningún archivo' }, { status: 400 });
    }

    if (file.size > MAX_SCAN_BYTES) {
      return NextResponse.json(
        { error: 'El documento excede el límite permitido de 20MB' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Obtener sesión por token o por tokenHash
    let session = null;
    if (token) {
      session = await getScanSessionByToken(token);
    } else if (tokenHash) {
      const { data } = await admin
        .from('scan_sessions')
        .select('*')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      session = data;
    }

    if (!session) {
      return NextResponse.json({ error: 'Sesión de escaneo no válida o expirada' }, { status: 403 });
    }

    if (session.status === 'completed') {
      return NextResponse.json(
        { error: 'Esta sesión de escaneo ya fue completada' },
        { status: 409 }
      );
    }

    // Convertir file a buffer/ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Validar cabecera PDF (%PDF-)
    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      return NextResponse.json(
        { error: 'El archivo recibido no es un documento PDF válido' },
        { status: 400 }
      );
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const safeName = sanitizeFileName(file.name || `escaneo-${dateStr}.pdf`);
    const storageBucket = session.storage_bucket || 'invoice-files';
    const storagePath = `${session.empresa_id}/scans/${session.id}/${safeName}`;

    // Subir a Storage privado
    const { error: uploadError } = await admin.storage
      .from(storageBucket)
      .upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Error al almacenar el documento: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Actualizar registro en DB
    const { data: updated, error: dbError } = await admin
      .from('scan_sessions')
      .update({
        status: 'completed',
        storage_path: storagePath,
        file_name: safeName,
        file_size_bytes: bytes.length,
        page_count: pageCount,
        completed_at: new Date().toISOString(),
      })
      .eq('id', session.id)
      .select()
      .single();

    if (dbError || !updated) {
      return NextResponse.json(
        { error: `Error al registrar documento completado: ${dbError?.message}` },
        { status: 500 }
      );
    }

    // Generar URL firmada de 5 minutos
    const { data: signedData } = await admin.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 300);

    return NextResponse.json({
      success: true,
      sessionId: session.id,
      storagePath,
      fileName: safeName,
      fileSizeBytes: bytes.length,
      pageCount,
      signedUrl: signedData?.signedUrl ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error interno al subir escaneo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
