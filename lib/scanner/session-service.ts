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

// Tracker en memoria para rate limiting rápido de PIN contra ataques de fuerza bruta
const pinAttemptTracker = new Map<string, { count: number; lockedUntil: number }>();
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutos

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
      pin_failed_attempts: 0,
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
 * Resuelve una sesión buscando por credencial operacional autorizada (mobileClaimToken).
 * REGLA ESTRICTA: El token QR inicial es SOLO para reclamo (claim); una vez reclamado,
 * todas las operaciones subsiguientes (status, upload, completion) requieren mobileClaimToken.
 */
export async function getScanSessionByCredential(credential: string): Promise<ScanSession | null> {
  if (!credential || credential.trim().length === 0) return null;
  const credHash = hashScanToken(credential.trim());
  const admin = createAdminClient();

  // OPERACIONES POST-CLAIM: Solo acepta mobile_claim_token_hash
  const { data: byMobileToken } = await admin
    .from('scan_sessions')
    .select('*')
    .eq('mobile_claim_token_hash', credHash)
    .maybeSingle();

  if (byMobileToken) {
    const session = byMobileToken as ScanSession;
    if (isSessionExpired(session.expires_at) && session.status !== 'completed') {
      await admin.from('scan_sessions').update({ status: 'expired' }).eq('id', session.id);
      session.status = 'expired';
    }
    return session;
  }

  return null;
}

/**
 * Busca una sesión por el token QR inicial durante la fase de CLAIM.
 * Solo resuelve sesiones activas en estado 'waiting'.
 */
export async function getScanSessionByToken(token: string): Promise<ScanSession | null> {
  if (!token || token.trim().length === 0) return null;
  const credHash = hashScanToken(token.trim());
  const admin = createAdminClient();

  const { data: byToken } = await admin
    .from('scan_sessions')
    .select('*')
    .eq('token_hash', credHash)
    .maybeSingle();

  if (byToken) {
    const session = byToken as ScanSession;
    if (isSessionExpired(session.expires_at) && session.status === 'waiting') {
      await admin.from('scan_sessions').update({ status: 'expired' }).eq('id', session.id);
      session.status = 'expired';
    }
    return session;
  }

  return null;
}

/**
 * Verifica un PIN con protección estricta contra fuerza bruta y rate-limiting persistente
 * indexado por ACTOR/ORIGEN (IP / identificador de dispositivo), no por el PIN probado.
 */
export async function verifyAndGetSessionByPin(
  pin: string,
  clientKey: string = 'default-client'
): Promise<ScanSession> {
  const cleanPin = (pin || '').trim();
  if (cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    throw new Error('El código PIN debe contener exactamente 6 dígitos numéricos');
  }

  const now = new Date();
  const admin = createAdminClient();

  // 1. Verificar si el actor está bloqueado (en base de datos persistente o fallback en memoria)
  let actorLocked = false;
  try {
    const { data: attemptRow } = await admin
      .from('scan_pin_attempts')
      .select('*')
      .eq('actor_key', clientKey)
      .maybeSingle();

    if (attemptRow && attemptRow.locked_until) {
      if (new Date(attemptRow.locked_until).getTime() > now.getTime()) {
        actorLocked = true;
      }
    }
  } catch {
    // Si la tabla no existe en entorno de test, usar tracker en memoria
    const mem = pinAttemptTracker.get(clientKey);
    if (mem && mem.lockedUntil > now.getTime()) {
      actorLocked = true;
    }
  }

  if (actorLocked) {
    throw new Error('Demasiados intentos fallidos. Sesión bloqueada temporalmente por seguridad');
  }

  // 2. Buscar sesión activa con ese PIN
  const { data, error } = await admin
    .from('scan_sessions')
    .select('*')
    .eq('pin_code', cleanPin)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    // Registrar intento fallido para este actor (IP/origen) en DB y en memoria
    let currentAttempts = 0;
    try {
      const { data: prevRow } = await admin
        .from('scan_pin_attempts')
        .select('failed_attempts')
        .eq('actor_key', clientKey)
        .maybeSingle();

      currentAttempts = (prevRow?.failed_attempts || 0) + 1;
      const lockedUntil =
        currentAttempts >= MAX_PIN_ATTEMPTS
          ? new Date(now.getTime() + LOCKOUT_DURATION_MS).toISOString()
          : null;

      await admin.from('scan_pin_attempts').upsert({
        actor_key: clientKey,
        failed_attempts: currentAttempts,
        locked_until: lockedUntil,
        last_attempt_at: now.toISOString(),
      });
    } catch {
      const mem = pinAttemptTracker.get(clientKey) || { count: 0, lockedUntil: 0 };
      currentAttempts = mem.count + 1;
      const lockedUntil = currentAttempts >= MAX_PIN_ATTEMPTS ? now.getTime() + LOCKOUT_DURATION_MS : 0;
      pinAttemptTracker.set(clientKey, { count: currentAttempts, lockedUntil });
    }

    throw new Error('Código PIN inválido');
  }

  const session = data as ScanSession;

  // Verificar si la sesión en DB está bloqueada por intentos
  if (session.pin_locked_until && new Date(session.pin_locked_until).getTime() > now.getTime()) {
    throw new Error('Sesión bloqueada por exceso de intentos fallidos');
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

  if (session.status !== 'waiting') {
    throw new Error('Esta sesión ya fue reclamada por otro dispositivo');
  }

  // Éxito: limpiar contador de intentos para este actor
  try {
    await admin.from('scan_pin_attempts').delete().eq('actor_key', clientKey);
  } catch {
    pinAttemptTracker.delete(clientKey);
  }

  return session;
}

/**
 * Reclama atómicamente una sesión de escaneo desde el dispositivo móvil.
 * Compare-and-Set atómico: solo una petición puede ganar la transición waiting -> connected.
 * Invalida el token QR original para que NO pueda usarse en operaciones posteriores.
 */
export async function claimScanSession(
  credentialOrPin: { token?: string; pin?: string } | string,
  deviceInfo: Record<string, unknown> = {},
  userId?: string | null
): Promise<ClaimSessionResult> {
  const admin = createAdminClient();
  let targetSession: ScanSession;

  const creds = typeof credentialOrPin === 'string' ? { token: credentialOrPin } : (credentialOrPin || {});
  const clientKey = String(deviceInfo.ip || deviceInfo.userAgent || 'default-client');

  if (creds.token) {
    const s = await getScanSessionByToken(creds.token);
    if (!s) {
      throw new Error('Sesión de escaneo no encontrada o ya reclamada');
    }
    targetSession = s;
  } else if (creds.pin) {
    targetSession = await verifyAndGetSessionByPin(creds.pin, clientKey);
  } else {
    throw new Error('Se requiere token o código PIN para vincular');
  }

  if (isSessionExpired(targetSession.expires_at) || targetSession.status === 'expired') {
    throw new Error('La sesión de escaneo ha expirado');
  }

  if (targetSession.status === 'completed') {
    throw new Error('Esta sesión de escaneo ya fue completada');
  }

  if (targetSession.status === 'canceled') {
    throw new Error('La sesión fue cancelada');
  }

  if (targetSession.status !== 'waiting') {
    throw new Error('Esta sesión ya fue reclamada por otro dispositivo');
  }

  // Generar credencial móvil temporal independiente (alta entropía, 32 bytes hex)
  const mobileClaimToken = generateScanToken();
  const mobileClaimTokenHash = hashScanToken(mobileClaimToken);

  // Compare-and-Set atómico: WHERE id = targetSession.id AND status = 'waiting'
  // Invalida token_hash para que el QR token inicial no sirva más
  const { data: updated, error: updateErr } = await admin
    .from('scan_sessions')
    .update({
      status: 'connected',
      mobile_claim_token_hash: mobileClaimTokenHash,
      token_hash: 'CLAIMED:' + targetSession.token_hash, // Invalida el QR token
      claimed_by_user_id: userId ?? null,
      claimed_device_info: deviceInfo,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', targetSession.id)
    .eq('status', 'waiting') // Atómico compare-and-set
    .select()
    .maybeSingle();

  if (updateErr || !updated) {
    throw new Error('Conflicto de concurrencia: la sesión ya fue reclamada por otro dispositivo');
  }

  return {
    session: updated as ScanSession,
    mobileClaimToken,
  };
}

/**
 * Actualiza el estado de la sesión (ej. 'scanning', 'processing') validando credencial.
 */
export async function updateScanSessionStatus(
  credential: string,
  status: ScanSessionStatus
): Promise<ScanSession> {
  const session = await getScanSessionByCredential(credential);
  if (!session) {
    throw new Error('Sesión no encontrada o credencial inválida');
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
 * Finaliza atómicamente la sesión asociando el PDF subido al storage.
 * Implementa protección anti-double-completion y compare-and-set.
 */
export async function completeScanSession(
  credential: string,
  payload: {
    storagePath: string;
    fileName: string;
    fileSizeBytes: number;
    pageCount: number;
  }
): Promise<ScanSession> {
  const session = await getScanSessionByCredential(credential);
  if (!session) {
    throw new Error('Sesión no encontrada o credencial inválida');
  }

  if (isSessionExpired(session.expires_at)) {
    throw new Error('La sesión ha expirado');
  }

  if (session.status === 'completed') {
    throw new Error('Esta sesión ya fue completada previamente (anti-replay)');
  }

  const admin = createAdminClient();

  // Compare-and-Set atómico: status debe ser connected, scanning o processing
  const { data, error } = await admin
    .from('scan_sessions')
    .update({
      status: 'completed',
      storage_path: payload.storagePath,
      file_name: payload.fileName,
      file_size_bytes: payload.fileSizeBytes,
      page_count: payload.pageCount,
      completed_at: new Date().toISOString(),
      mobile_claim_token_hash: null, // Invalida la credencial móvil temporal
    })
    .eq('id', session.id)
    .in('status', ['connected', 'scanning', 'processing']) // Atómico
    .select()
    .maybeSingle();

  if (error || !data) {
    throw new Error('Esta sesión ya fue completada previamente (anti-replay)');
  }

  return data as ScanSession;
}
