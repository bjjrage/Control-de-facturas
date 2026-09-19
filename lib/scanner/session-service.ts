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
  const ttlMinutes = options.ttlMinutes ?? 15;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const contextType = options.contextType ?? 'general';
  const contextId = options.contextId ?? null;
  const targetField = options.targetField ?? null;
  const metadata = options.metadata ?? {};
  const storageBucket = 'invoice-files';

  const admin = createAdminClient();

  // Bucle de reintento para garantizar unicidad DB-backed del PIN entre sesiones reclamables
  let session: ScanSession | null = null;
  let lastError: Error | null = null;
  const MAX_PIN_RETRIES = 5;

  for (let attempt = 0; attempt < MAX_PIN_RETRIES; attempt++) {
    const pinCode = generateScanPin();

    // 1. Intentar creación atómica vía RPC si está disponible
    try {
      const { data: rpcData, error: rpcError } = await admin.rpc('scan_session_create_atomic', {
        p_empresa_id: empresaId,
        p_user_id: userId,
        p_token_hash: tokenHash,
        p_pin_code: pinCode,
        p_expires_at: expiresAt,
        p_context_type: contextType,
        p_context_id: contextId,
        p_target_field: targetField,
        p_storage_bucket: storageBucket,
      });

      if (!rpcError && rpcData) {
        session = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as ScanSession;
        break;
      }

      if (rpcError) {
        const isCollision =
          rpcError.code === '23505' ||
          rpcError.message?.includes('unique') ||
          rpcError.message?.includes('duplicate');
        if (isCollision) {
          continue; // Colisión de PIN: reintentar con nuevo PIN
        }
        if (rpcError.message?.includes('does not exist') || rpcError.message?.includes('function')) {
          throw new Error('RPC_NOT_FOUND');
        }
        throw new Error(rpcError.message);
      }
    } catch (rpcErr: any) {
      if (rpcErr?.message !== 'RPC_NOT_FOUND') {
        // En caso de mock o fallback, continuar a inserción directa
      }
    }

    // 2. Fallback de inserción directa con chequeo de colisión
    const { data: existingActive } = await admin
      .from('scan_sessions')
      .select('id, expires_at')
      .eq('pin_code', pinCode)
      .eq('status', 'waiting')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (existingActive) {
      continue; // PIN en uso activo por otro tenant/sesión, reintentar
    }

    const { data, error } = await admin
      .from('scan_sessions')
      .insert({
        empresa_id: empresaId,
        created_by: userId,
        context_type: contextType,
        context_id: contextId,
        target_field: targetField,
        status: 'waiting',
        token_hash: tokenHash,
        pin_code: pinCode,
        expires_at: expiresAt,
        storage_bucket: storageBucket,
        metadata,
        pin_failed_attempts: 0,
      })
      .select()
      .single();

    if (error) {
      const isCollision =
        error.code === '23505' ||
        error.message?.includes('unique') ||
        error.message?.includes('duplicate');
      if (isCollision) {
        continue; // Reintentar con nuevo PIN
      }
      lastError = new Error(`Error al crear sesión de escaneo: ${error.message}`);
      break;
    }

    if (data) {
      session = data as ScanSession;
      break;
    }
  }

  if (!session) {
    throw lastError || new Error('No se pudo generar un PIN único no colisionante tras múltiples intentos');
  }

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

  // 1. Verificación atómica de bloqueo para este actor (IP / device fingerprint)
  let actorLocked = false;
  try {
    const { data: lockRows, error: lockErr } = await admin.rpc('scan_pin_check_actor_lock', {
      p_actor_key: clientKey,
    });
    if (!lockErr && lockRows) {
      const lockData = Array.isArray(lockRows) ? lockRows[0] : lockRows;
      if (lockData?.is_locked) {
        actorLocked = true;
      }
    } else {
      throw new Error('RPC_FALLBACK');
    }
  } catch {
    // Fallback: tabla directa o memoria
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
      const mem = pinAttemptTracker.get(clientKey);
      if (mem && mem.lockedUntil > now.getTime()) {
        actorLocked = true;
      }
    }
  }

  if (actorLocked) {
    throw new Error('Demasiados intentos fallidos. Sesión bloqueada temporalmente por seguridad');
  }

  // 2. Buscar sesión activa reclamable con ese PIN
  // Filtro estricto: status = 'waiting' y expires_at > now.
  // Gracias al índice único parcial DB-backed, existe como máximo 1 sesión claimable con este PIN en todo el sistema.
  const { data, error } = await admin
    .from('scan_sessions')
    .select('*')
    .eq('pin_code', cleanPin)
    .eq('status', 'waiting')
    .gt('expires_at', now.toISOString())
    .maybeSingle();

  if (error || !data) {
    // 3. Registro ATÓMICO del intento fallido en PostgreSQL (sin lost-updates bajo concurrencia)
    let isLocked = false;
    try {
      const { data: rpcRes, error: rpcErr } = await admin.rpc('scan_pin_record_failed_attempt', {
        p_actor_key: clientKey,
        p_max_attempts: MAX_PIN_ATTEMPTS,
        p_lockout_seconds: Math.floor(LOCKOUT_DURATION_MS / 1000),
      });

      if (!rpcErr && rpcRes) {
        const row = Array.isArray(rpcRes) ? rpcRes[0] : rpcRes;
        isLocked = !!row?.is_locked;
      } else {
        throw new Error('RPC_FALLBACK');
      }
    } catch {
      // Fallback en memoria en caso de test ligero sin base de datos real
      const mem = pinAttemptTracker.get(clientKey) || { count: 0, lockedUntil: 0 };
      const currentAttempts = mem.count + 1;
      const lockedUntil = currentAttempts >= MAX_PIN_ATTEMPTS ? now.getTime() + LOCKOUT_DURATION_MS : 0;
      pinAttemptTracker.set(clientKey, { count: currentAttempts, lockedUntil });
      isLocked = currentAttempts >= MAX_PIN_ATTEMPTS;
    }

    if (isLocked) {
      throw new Error('Demasiados intentos fallidos. Sesión bloqueada temporalmente por seguridad');
    }

    throw new Error('Código PIN inválido');
  }

  const session = data as ScanSession;

  // 4. Éxito: limpiar contador de intentos atómicamente para este actor
  try {
    await admin.rpc('scan_pin_reset_actor_attempts', { p_actor_key: clientKey });
  } catch {
    pinAttemptTracker.delete(clientKey);
  }

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
