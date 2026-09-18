import { createAdminClient } from '@/lib/supabase/admin';
import {
  ClaimSessionResult,
  CreateSessionOptions,
  CreateSessionResult,
  ScanSession,
  ScanSessionStatus,
} from './types';
import {
  generateScanPin,
  generateScanToken,
  hashScanToken,
  isSessionExpired,
} from './tokens';

/**
 * Crea una nueva sesión de escaneo temporal desde el ERP Desktop.
 */
export async function createScanSession(
  empresaId: string,
  userId: string | null,
  options: CreateSessionOptions = {}
): Promise<CreateSessionResult> {
  const token = generateScanToken();
  const tokenHash = hashScanToken(token);
  const pinCode = generateScanPin();
  const ttlMinutes = options.ttlMinutes ?? 15;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();

  const admin = createAdminClient();

  const { data, error } = await admin
    .from('scan_sessions')
    .insert({
      empresa_id: empresaId,
      created_by: userId,
      context_type: options.contextType ?? 'general',
      context_id: options.contextId ?? null,
      target_field: options.targetField ?? null,
      status: 'waiting',
      token_hash: tokenHash,
      pin_code: pinCode,
      expires_at: expiresAt,
      storage_bucket: 'invoice-files',
      metadata: options.metadata ?? {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Error al crear sesión de escaneo: ${error?.message || 'desconocido'}`);
  }

  const session = data as ScanSession;
  const joinUrl = `/scanner?t=${token}`;

  return {
    session,
    token,
    joinUrl,
  };
}

/**
 * Obtiene una sesión activa a partir de su token en texto claro.
 */
export async function getScanSessionByToken(token: string): Promise<ScanSession | null> {
  if (!token) return null;
  const tokenHash = hashScanToken(token);
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('scan_sessions')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  const session = data as ScanSession;
  if (isSessionExpired(session.expires_at)) {
    if (session.status === 'waiting' || session.status === 'connected') {
      await admin
        .from('scan_sessions')
        .update({ status: 'expired' })
        .eq('id', session.id);
      session.status = 'expired';
    }
  }

  return session;
}

/**
 * Reclama una sesión de escaneo desde el dispositivo móvil.
 */
export async function claimScanSession(
  token: string,
  deviceInfo: Record<string, unknown> = {},
  userId?: string | null
): Promise<ClaimSessionResult> {
  const session = await getScanSessionByToken(token);
  if (!session) {
    throw new Error('Sesión de escaneo no encontrada');
  }

  if (isSessionExpired(session.expires_at) || session.status === 'expired') {
    throw new Error('La sesión de escaneo ha expirado');
  }

  if (session.status === 'completed') {
    throw new Error('Esta sesión de escaneo ya fue completada');
  }

  if (session.status === 'canceled') {
    throw new Error('La sesión fue cancelada');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('scan_sessions')
    .update({
      status: 'connected',
      claimed_by_user_id: userId ?? null,
      claimed_device_info: deviceInfo,
    })
    .eq('id', session.id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Error al vincular sesión: ${error?.message || 'desconocido'}`);
  }

  return {
    session: data as ScanSession,
    token,
  };
}

/**
 * Actualiza el estado de la sesión (ej. 'scanning', 'processing').
 */
export async function updateScanSessionStatus(
  token: string,
  status: ScanSessionStatus
): Promise<ScanSession> {
  const session = await getScanSessionByToken(token);
  if (!session) {
    throw new Error('Sesión no encontrada');
  }

  if (isSessionExpired(session.expires_at)) {
    throw new Error('La sesión ha expirado');
  }

  if (session.status === 'completed') {
    throw new Error('No se puede modificar una sesión completada');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('scan_sessions')
    .update({ status })
    .eq('id', session.id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Error al actualizar estado: ${error?.message || 'desconocido'}`);
  }

  return data as ScanSession;
}

/**
 * Finaliza la sesión asociando el PDF subido al storage.
 */
export async function completeScanSession(
  token: string,
  payload: {
    storagePath: string;
    fileName: string;
    fileSizeBytes: number;
    pageCount: number;
  }
): Promise<ScanSession> {
  const session = await getScanSessionByToken(token);
  if (!session) {
    throw new Error('Sesión no encontrada');
  }

  if (isSessionExpired(session.expires_at)) {
    throw new Error('La sesión ha expirado');
  }

  if (session.status === 'completed') {
    throw new Error('Esta sesión ya fue completada previamente (anti-replay)');
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('scan_sessions')
    .update({
      status: 'completed',
      storage_path: payload.storagePath,
      file_name: payload.fileName,
      file_size_bytes: payload.fileSizeBytes,
      page_count: payload.pageCount,
      completed_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Error al completar sesión: ${error?.message || 'desconocido'}`);
  }

  return data as ScanSession;
}

/**
 * Busca una sesión activa por su código PIN de 6 dígitos.
 */
export async function getScanSessionByPin(pin: string): Promise<ScanSession | null> {
  if (!pin || pin.trim().length !== 6) return null;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('scan_sessions')
    .select('*')
    .eq('pin_code', pin.trim())
    .in('status', ['waiting', 'connected', 'scanning'])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ScanSession;
}
