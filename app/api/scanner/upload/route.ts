import { NextRequest, NextResponse } from 'next/server';
import { completeScanSession, getScanSessionByCredential } from '@/lib/scanner/session-service';
import { createAdminClient } from '@/lib/supabase/admin';
import { sanitizeFileName } from '@/lib/storage';

const MAX_SCAN_BYTES = 20 * 1024 * 1024; // 20MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const token = formData.get('token') as string | null;
    const mobileClaimToken = formData.get('mobileClaimToken') as string | null;
    const file = formData.get('file') as File | null;
    const pageCountStr = formData.get('pageCount') as string | null;
    const pageCount = pageCountStr ? parseInt(pageCountStr, 10) : 1;

    // RECHAZO EXPLÍCITO: tokenHash no es una credencial cliente válida
    if (formData.has('tokenHash')) {
      return NextResponse.json(
        { error: 'tokenHash no es una credencial cliente permitida' },
        { status: 400 }
      );
    }

    // El token QR inicial es exclusivamente para CLAIM; operaciones posteriores requieren mobileClaimToken
    if (formData.has('token') && !formData.has('mobileClaimToken')) {
      return NextResponse.json(
        { error: 'El token QR inicial no es válido para operaciones posteriores. Se requiere mobileClaimToken.' },
        { status: 401 }
      );
    }

    const credential = (mobileClaimToken || token || '').trim();
    if (!credential) {
      return NextResponse.json(
        { error: 'Se requiere credencial móvil autorizada (mobileClaimToken)' },
        { status: 401 }
      );
    }

    if (!file) {
      return NextResponse.json({ error: 'No se envió ningún archivo' }, { status: 400 });
    }

    if (file.size > MAX_SCAN_BYTES) {
      return NextResponse.json(
        { error: 'El documento excede el límite permitido de 20MB' },
        { status: 400 }
      );
    }

    if (Number.isNaN(pageCount) || pageCount < 1 || pageCount > 100) {
      return NextResponse.json(
        { error: 'Cantidad de páginas no válida' },
        { status: 400 }
      );
    }

    // 1. Resolver y validar sesión por credencial móvil
    const session = await getScanSessionByCredential(credential);
    if (!session) {
      return NextResponse.json(
        { error: 'Sesión de escaneo no válida o credencial no autorizada' },
        { status: 403 }
      );
    }

    if (session.status === 'completed') {
      return NextResponse.json(
        { error: 'Esta sesión de escaneo ya fue completada (anti-replay)' },
        { status: 409 }
      );
    }

    if (session.status === 'expired') {
      return NextResponse.json(
        { error: 'La sesión de escaneo ha expirado' },
        { status: 410 }
      );
    }

    if (session.status === 'canceled') {
      return NextResponse.json(
        { error: 'La sesión de escaneo fue cancelada' },
        { status: 400 }
      );
    }

    // 2. Validar contenido real del archivo (magic bytes %PDF-)
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') {
      return NextResponse.json(
        { error: 'El archivo recibido no es un documento PDF válido' },
        { status: 400 }
      );
    }

    // 3. Derivar path de almacenamiento de forma estrictamente server-side (tenant safe)
    const dateStr = new Date().toISOString().split('T')[0];
    const safeName = sanitizeFileName(file.name || `escaneo-${dateStr}.pdf`);
    const storageBucket = session.storage_bucket || 'invoice-files';
    // Path estructurado por tenant: {empresa_id}/scans/{session_id}/{filename}
    const storagePath = `${session.empresa_id}/scans/${session.id}/${safeName}`;

    const admin = createAdminClient();

    // 4. Subir a Storage privado (already exists NUNCA es success)
    const { error: uploadError } = await admin.storage
      .from(storageBucket)
      .upload(storagePath, bytes, {
        contentType: 'application/pdf',
        upsert: false, // Prevenir sobreescritura accidental
      });

    if (uploadError) {
      const isDuplicate =
        uploadError.message?.includes('already exists') ||
        uploadError.message?.includes('Duplicate') ||
        uploadError.message?.includes('409');
      return NextResponse.json(
        {
          error: isDuplicate
            ? 'El archivo ya existe o hay otra subida en curso para esta sesión'
            : `Error al almacenar el documento: ${uploadError.message}`,
        },
        { status: isDuplicate ? 409 : 500 }
      );
    }

    // 5. Finalización atómica con compare-and-set
    let updatedSession;
    try {
      updatedSession = await completeScanSession(credential, {
        storagePath,
        fileName: safeName,
        fileSizeBytes: bytes.length,
        pageCount,
      });
    } catch (completeErr: unknown) {
      // Limpiar de forma segura el archivo subido si el CAS de completion perdió la carrera
      await admin.storage.from(storageBucket).remove([storagePath]).catch(() => {});
      const msg = completeErr instanceof Error ? completeErr.message : 'Error al completar sesión';
      return NextResponse.json({ error: msg }, { status: 409 });
    }

    // 6. Generar URL firmada temporal de 5 minutos
    const { data: signedData } = await admin.storage
      .from(storageBucket)
      .createSignedUrl(storagePath, 300);

    return NextResponse.json({
      success: true,
      sessionId: updatedSession.id,
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
