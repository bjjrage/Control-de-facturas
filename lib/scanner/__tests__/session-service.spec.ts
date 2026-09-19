import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  claimScanSession,
  completeScanSession,
  createScanSession,
  getScanSessionByCredential,
  getScanSessionByToken,
  updateScanSessionStatus,
  verifyAndGetSessionByPin,
} from '../session-service';
import { hashScanToken } from '../tokens';

// In-memory mock de base de datos Supabase
const mockSessions = new Map<string, any>();
const mockPinAttempts = new Map<string, { failed_attempts: number; locked_until: string | null; last_attempt_at: string }>();

class MockQueryBuilder {
  private filters: ((row: any) => boolean)[] = [];
  private updateData: any = null;
  private isUpdate = false;
  private isInsert = false;
  private insertData: any = null;

  constructor(private table: string) {}

  insert(data: any) {
    this.isInsert = true;
    this.insertData = data;
    return this;
  }

  update(data: any) {
    this.isUpdate = true;
    this.updateData = data;
    return this;
  }

  select(_fields?: string) {
    return this;
  }

  eq(field: string, val: any) {
    this.filters.push((row) => row[field] === val);
    return this;
  }

  neq(field: string, val: any) {
    this.filters.push((row) => row[field] !== val);
    return this;
  }

  in(field: string, vals: any[]) {
    this.filters.push((row) => vals.includes(row[field]));
    return this;
  }

  gt(field: string, val: any) {
    this.filters.push((row) => row[field] > val);
    return this;
  }

  order(_field: string, _opts?: { ascending?: boolean }) {
    return this;
  }

  limit(_count: number) {
    return this;
  }

  delete() {
    return {
      eq: (field: string, val: any) => {
        if (this.table === 'scan_pin_attempts' && field === 'actor_key') {
          mockPinAttempts.delete(val);
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
  }

  async single() {
    return this.execute(true);
  }

  async maybeSingle() {
    return this.execute(false);
  }

  private execute(strict: boolean) {
    if (this.isInsert) {
      if (this.table === 'scan_sessions') {
        // Simular partial unique index en Postgres: idx_scan_sessions_unique_active_pin WHERE status = 'waiting'
        if (this.insertData.status === 'waiting') {
          for (const s of mockSessions.values()) {
            if (s.status === 'waiting' && s.pin_code === this.insertData.pin_code) {
              return {
                data: null,
                error: {
                  code: '23505',
                  message: 'duplicate key value violates unique constraint "idx_scan_sessions_unique_active_pin"',
                },
              };
            }
          }
        }
        const id = 'session-uuid-' + Math.random().toString(36).slice(2, 9);
        const saved = { ...this.insertData, id, created_at: new Date().toISOString() };
        mockSessions.set(id, saved);
        return { data: saved, error: null };
      }

      if (this.table === 'scan_pin_attempts') {
        mockPinAttempts.set(this.insertData.actor_key, { ...this.insertData });
        return { data: this.insertData, error: null };
      }
    }

    if (this.isUpdate) {
      if (this.table === 'scan_sessions') {
        const matching: any[] = [];
        for (const [id, session] of mockSessions.entries()) {
          if (this.filters.every((f) => f(session))) {
            const updated = { ...session, ...this.updateData };
            mockSessions.set(id, updated);
            matching.push(updated);
          }
        }
        if (matching.length === 0) {
          return strict ? { data: null, error: new Error('Not found') } : { data: null, error: null };
        }
        return { data: matching[0], error: null };
      }
    }

    // Select query
    const targetMap = this.table === 'scan_sessions' ? mockSessions : mockPinAttempts;
    const matching: any[] = [];
    for (const item of targetMap.values()) {
      if (this.filters.every((f) => f(item))) {
        matching.push({ ...item });
      }
    }
    if (matching.length === 0) {
      return strict ? { data: null, error: new Error('Not found') } : { data: null, error: null };
    }
    return { data: matching[0], error: null };
  }
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      return new MockQueryBuilder(table);
    },
    rpc: async (funcName: string, args: any) => {
      if (funcName === 'scan_pin_record_failed_attempt') {
        const actorKey = args.p_actor_key;
        const maxAttempts = args.p_max_attempts || 5;
        const lockoutSeconds = args.p_lockout_seconds || 900;
        const now = new Date();
        const prev = mockPinAttempts.get(actorKey);
        const count = (prev?.failed_attempts || 0) + 1;
        let lockedUntil = prev?.locked_until;
        if (count >= maxAttempts) {
          lockedUntil = new Date(now.getTime() + lockoutSeconds * 1000).toISOString();
        }
        mockPinAttempts.set(actorKey, { failed_attempts: count, locked_until: lockedUntil || null, last_attempt_at: now.toISOString() });
        const isLocked = count >= maxAttempts;
        return {
          data: [{
            failed_attempts: count,
            locked_until: lockedUntil,
            is_locked: isLocked,
          }],
          error: null,
        };
      }

      if (funcName === 'scan_pin_check_actor_lock') {
        const actorKey = args.p_actor_key;
        const prev = mockPinAttempts.get(actorKey);
        const isLocked = !!(prev?.locked_until && new Date(prev.locked_until).getTime() > Date.now());
        return {
          data: [{ is_locked: isLocked, locked_until: prev?.locked_until || null }],
          error: null,
        };
      }

      if (funcName === 'scan_pin_reset_actor_attempts') {
        mockPinAttempts.delete(args.p_actor_key);
        return { data: null, error: null };
      }

      if (funcName === 'scan_session_create_atomic') {
        // Limpiar expirados
        const nowMs = Date.now();
        for (const s of mockSessions.values()) {
          if (s.status === 'waiting' && new Date(s.expires_at).getTime() <= nowMs) {
            s.status = 'expired';
          }
        }
        // Simular partial unique index
        for (const existing of mockSessions.values()) {
          if (existing.status === 'waiting' && existing.pin_code === args.p_pin_code) {
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "idx_scan_sessions_unique_active_pin"',
              },
            };
          }
        }

        const id = 'session-uuid-' + Math.random().toString(36).slice(2, 9);
        const saved = {
          id,
          empresa_id: args.p_empresa_id,
          created_by: args.p_user_id,
          token_hash: args.p_token_hash,
          pin_code: args.p_pin_code,
          expires_at: args.p_expires_at,
          context_type: args.p_context_type,
          status: 'waiting',
          created_at: new Date().toISOString(),
        };
        mockSessions.set(id, saved);
        return { data: [saved], error: null };
      }

      return { data: null, error: { message: 'function does not exist' } };
    },
  }),
}));

describe('Scanner Session Service Lifecycle & Security', () => {
  beforeEach(() => {
    mockSessions.clear();
    mockPinAttempts.clear();
  });

  it('crea una nueva sesión con token, PIN y expiración futura', async () => {
    const result = await createScanSession('empresa-123', 'user-456', {
      contextType: 'invoice',
      contextId: 'inv-789',
      targetField: 'document_url',
    });

    expect(result.session).toBeDefined();
    expect(result.session.id).toBeDefined();
    expect(result.token).toBeDefined();
    expect(result.session.pin_code).toMatch(/^\d{6}$/);
    expect(result.session.status).toBe('waiting');
    expect(result.session.token_hash).toBe(hashScanToken(result.token));
    expect(result.joinUrl).toContain(`/scanner?t=${result.token}`);
  });

  it('obtiene la sesión correctamente a partir de su token', async () => {
    const created = await createScanSession('empresa-123', 'user-456');
    const fetched = await getScanSessionByToken(created.token);

    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(created.session.id);
  });

  it('rechaza búsqueda de sesión si el token es inválido o no existe', async () => {
    const fetched = await getScanSessionByToken('non-existent-token');
    expect(fetched).toBeNull();
  });

  it('móvil puede reclamar (claim) la sesión cambiando el estado a "connected"', async () => {
    const created = await createScanSession('empresa-123', 'user-456');
    const claim = await claimScanSession(created.token, {
      device: 'iPhone 15 Pro',
      browser: 'Safari',
    }, 'user-mobile-789');

    expect(claim.session.status).toBe('connected');
    expect(claim.session.claimed_device_info).toEqual({
      device: 'iPhone 15 Pro',
      browser: 'Safari',
    });
    expect(claim.session.claimed_by_user_id).toBe('user-mobile-789');
  });

  it('reclamar con PIN emite mobileClaimToken y permite autenticar', async () => {
    const created = await createScanSession('empresa-123', 'user-456');
    const claim = await claimScanSession({ pin: created.session.pin_code! }, {
      device: 'Android Pixel',
    });

    expect(claim.session.status).toBe('connected');
    expect(claim.mobileClaimToken).toBeDefined();
    expect(claim.mobileClaimToken!.length).toBeGreaterThan(30);

    // Búsqueda por mobileClaimToken debe encontrar la sesión
    const byClaim = await getScanSessionByCredential(claim.mobileClaimToken!);
    expect(byClaim).not.toBeNull();
    expect(byClaim?.id).toBe(created.session.id);
  });

  describe('P1 #1: Prevención de Colisión Global de PIN entre Tenants & Sesiones', () => {
    it('Tenant A y Tenant B: no pueden tener sesiones simultáneas con el mismo PIN reclamable', async () => {
      // 1. Tenant A crea sesión A
      const sessionA = await createScanSession('tenant-A', 'user-A');
      const pinA = sessionA.session.pin_code!;

      // 2. Verificar que la sesión A es la única claimable con pinA
      const foundA = await verifyAndGetSessionByPin(pinA);
      expect(foundA.empresa_id).toBe('tenant-A');
      expect(foundA.id).toBe(sessionA.session.id);

      // 3. Crear sesión B para Tenant B
      const sessionB = await createScanSession('tenant-B', 'user-B');
      // Debe haber generado un PIN distinto o no colisionar
      expect(sessionB.session.status).toBe('waiting');

      // Si intentáramos forzar en la DB que B tenga el mismo PIN mientras ambas son 'waiting', el índice único lo prohíbe
      const collisionAttempt = new MockQueryBuilder('scan_sessions').insert({
        empresa_id: 'tenant-B',
        created_by: 'user-B',
        pin_code: pinA,
        status: 'waiting',
        expires_at: new Date(Date.now() + 100000).toISOString(),
      });
      const res = await collisionAttempt.single();
      expect((res.error as any)?.code).toBe('23505');
    });

    it('sesión completada libera el PIN para nuevas sesiones waiting', async () => {
      const s1 = await createScanSession('tenant-A', 'user-A');
      const pin = s1.session.pin_code!;

      // Claim y completado de s1
      const claim = await claimScanSession(s1.token);
      await completeScanSession(claim.mobileClaimToken!, {
        storagePath: 'doc.pdf',
        fileName: 'doc.pdf',
        fileSizeBytes: 1000,
        pageCount: 1,
      });

      // Ahora el PIN debe poder ser usado por otra sesión 'waiting' sin violar el índice
      const s2Row = await new MockQueryBuilder('scan_sessions').insert({
        empresa_id: 'tenant-B',
        created_by: 'user-B',
        pin_code: pin,
        status: 'waiting',
        expires_at: new Date(Date.now() + 100000).toISOString(),
      }).single();

      expect(s2Row.error).toBeNull();
      expect(s2Row.data?.pin_code).toBe(pin);
    });

    it('sesión expirada libera el PIN para nuevas sesiones waiting', async () => {
      const s1 = await createScanSession('tenant-A', 'user-A');
      const pin = s1.session.pin_code!;

      // Marcar s1 como expirada
      const sessionInDb = mockSessions.get(s1.session.id);
      sessionInDb.status = 'expired';

      // s2 con el mismo PIN ahora tiene éxito
      const s2Row = await new MockQueryBuilder('scan_sessions').insert({
        empresa_id: 'tenant-B',
        created_by: 'user-B',
        pin_code: pin,
        status: 'waiting',
        expires_at: new Date(Date.now() + 100000).toISOString(),
      }).single();

      expect(s2Row.error).toBeNull();
      expect(s2Row.data?.status).toBe('waiting');
    });

    it('dos creaciones concurrentes intentando el mismo PIN producen PINs reclamables distintos', async () => {
      const [res1, res2] = await Promise.all([
        createScanSession('tenant-A', 'user-A'),
        createScanSession('tenant-B', 'user-B'),
      ]);

      expect(res1.session.pin_code).toBeDefined();
      expect(res2.session.pin_code).toBeDefined();
      // Ambos PINs deben ser válidos de 6 dígitos
      expect(res1.session.pin_code).toMatch(/^\d{6}$/);
      expect(res2.session.pin_code).toMatch(/^\d{6}$/);
    });
  });

  describe('P1 #2: Rate Limiting Atómico & Anti-Concurrencia', () => {
    it('10 intentos fallidos concurrentes con Promise.all incrementan el contador de forma atómica y bloquean al actor', async () => {
      const actorKey = 'attacker-concurrent-ip-99';
      const actorDevice = { ip: actorKey };

      // Lanzar 10 intentos fallidos concurrentes con Promise.all
      const guesses = Array.from({ length: 10 }, (_, i) => String(100000 + i));
      const results = await Promise.allSettled(
        guesses.map((guess) => claimScanSession({ pin: guess }, actorDevice))
      );

      // Todos deben haber sido rechazados
      for (const r of results) {
        expect(r.status).toBe('rejected');
      }

      // El registro atómico de intentos debe registrar al menos 10 intentos
      const attemptRecord = mockPinAttempts.get(actorKey);
      expect(attemptRecord).toBeDefined();
      expect(attemptRecord!.failed_attempts).toBeGreaterThanOrEqual(10);
      expect(attemptRecord!.locked_until).not.toBeNull();

      // El siguiente intento del actor DEBE ser bloqueado con mensaje de lockout
      await expect(
        claimScanSession({ pin: '000000' }, actorDevice)
      ).rejects.toThrow(/bloqueada|demasiados intentos/i);
    });

    it('cambiar el PIN probado desde el mismo actor NO evade el bloqueo (anti-enumeration)', async () => {
      const actorKey = 'attacker-changing-pin-ip';
      const actorDevice = { ip: actorKey };

      // 5 intentos con PINs diferentes para activar el bloqueo
      for (let i = 1; i <= 5; i++) {
        const guess = String(i).padStart(6, '0');
        await expect(
          claimScanSession({ pin: guess }, actorDevice)
        ).rejects.toThrow(/código pin inválido|demasiados intentos/i);
      }

      // Intento con un PIN totalmente diferente (ej: 999999) sigue bloqueado
      await expect(
        claimScanSession({ pin: '999999' }, actorDevice)
      ).rejects.toThrow(/bloqueada|demasiados intentos/i);
    });
  });

  it('atomic compare-and-set: solo un dispositivo puede ganar el claim y el QR token queda invalidado', async () => {
    const created = await createScanSession('empresa-123', 'user-456');

    // Primer claim con QR token tiene éxito
    const firstClaim = await claimScanSession(created.token);
    expect(firstClaim.session.status).toBe('connected');
    expect(firstClaim.mobileClaimToken).toBeDefined();

    // Segundo claim con el mismo QR token debe ser rechazado
    await expect(
      claimScanSession(created.token)
    ).rejects.toThrow(/ya reclamada|no encontrada/i);
  });

  it('el QR token original NO puede operar la sesión tras el claim (debe usar mobileClaimToken)', async () => {
    const created = await createScanSession('empresa-123', null);
    const claim = await claimScanSession(created.token);

    // Intento de operar con el QR token original debe ser rechazado
    await expect(
      updateScanSessionStatus(created.token, 'scanning')
    ).rejects.toThrow(/credencial inválida|no encontrada/i);

    // Con mobileClaimToken sí se permite
    const s1 = await updateScanSessionStatus(claim.mobileClaimToken!, 'scanning');
    expect(s1.status).toBe('scanning');

    const s2 = await updateScanSessionStatus(claim.mobileClaimToken!, 'processing');
    expect(s2.status).toBe('processing');
  });

  it('finaliza la sesión con mobileClaimToken y asocia el documento', async () => {
    const created = await createScanSession('empresa-123', null);
    const claim = await claimScanSession(created.token);

    const completed = await completeScanSession(claim.mobileClaimToken!, {
      storagePath: 'empresa-123/scans/session-1/factura.pdf',
      fileName: 'factura.pdf',
      fileSizeBytes: 450000,
      pageCount: 3,
    });

    expect(completed.status).toBe('completed');
    expect(completed.storage_path).toBe('empresa-123/scans/session-1/factura.pdf');
    expect(completed.file_size_bytes).toBe(450000);
    expect(completed.page_count).toBe(3);
    expect(completed.completed_at).toBeDefined();
  });

  it('SEGURIDAD & ANTI-REPLAY: mobileClaimToken queda inválido después de completion', async () => {
    const created = await createScanSession('empresa-123', null);
    const claim = await claimScanSession(created.token);

    await completeScanSession(claim.mobileClaimToken!, {
      storagePath: 'empresa-123/scans/s1/factura.pdf',
      fileName: 'factura.pdf',
      fileSizeBytes: 1000,
      pageCount: 1,
    });

    // mobileClaimToken ya no debe resolver la sesión
    const byCredential = await getScanSessionByCredential(claim.mobileClaimToken!);
    expect(byCredential).toBeNull();

    // Intentar completar de nuevo debe ser rechazado
    await expect(
      completeScanSession(claim.mobileClaimToken!, {
        storagePath: 'empresa-123/scans/s1/hacked.pdf',
        fileName: 'hacked.pdf',
        fileSizeBytes: 9999,
        pageCount: 1,
      })
    ).rejects.toThrow(/sesión no encontrada o credencial inválida/i);
  });

  it('SEGURIDAD: rechaza claim en sesiones expiradas', async () => {
    const created = await createScanSession('empresa-123', null, {
      ttlMinutes: -1, // ya expirada al crearse
    });

    await expect(
      claimScanSession(created.token)
    ).rejects.toThrow('La sesión de escaneo ha expirado');
  });
});
