import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  claimScanSession,
  completeScanSession,
  createScanSession,
  getScanSessionByCredential,
  getScanSessionByToken,
  updateScanSessionStatus,
} from '../session-service';
import { hashScanToken } from '../tokens';

// In-memory mock de base de datos Supabase
const mockSessions = new Map<string, any>();

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

  select(fields?: string) {
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

  order(field: string, opts?: { ascending?: boolean }) {
    return this;
  }

  limit(count: number) {
    return this;
  }

  async single() {
    return this.execute(true);
  }

  async maybeSingle() {
    return this.execute(false);
  }

  private execute(strict: boolean) {
    if (this.isInsert) {
      const id = 'session-uuid-' + Math.random().toString(36).slice(2, 9);
      const saved = { ...this.insertData, id, created_at: new Date().toISOString() };
      mockSessions.set(id, saved);
      return { data: saved, error: null };
    }

    if (this.isUpdate) {
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

    // Select query
    const matching: any[] = [];
    for (const session of mockSessions.values()) {
      if (this.filters.every((f) => f(session))) {
        matching.push({ ...session });
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
      if (table !== 'scan_sessions') throw new Error(`Unexpected table ${table}`);
      return new MockQueryBuilder(table);
    },
    rpc: async () => {
      // Forzar fallback a compare-and-set estándar en tests unitarios para verificar la lógica TypeScript
      return { data: null, error: { message: 'function does not exist' } };
    },
  }),
}));

describe('Scanner Session Service Lifecycle & Security', () => {
  beforeEach(() => {
    mockSessions.clear();
  });

  it('crea una nueva sesión con token, PIN y expiración futura', async () => {
    const result = await createScanSession('empresa-123', 'user-456', {
      contextType: 'invoice',
      ttlMinutes: 15,
    });

    expect(result.session.id).toBeDefined();
    expect(result.session.empresa_id).toBe('empresa-123');
    expect(result.session.status).toBe('waiting');
    expect(result.session.pin_code).toMatch(/^\d{6}$/);
    expect(result.token).toHaveLength(64);
    expect(result.joinUrl).toBe(`/scanner?t=${result.token}`);

    // Expiración debe ser ~15 minutos en el futuro
    const expiry = new Date(result.session.expires_at).getTime();
    expect(expiry).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('obtiene la sesión correctamente a partir de su token', async () => {
    const created = await createScanSession('empresa-123', null);
    const retrieved = await getScanSessionByToken(created.token);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(created.session.id);
    expect(retrieved?.status).toBe('waiting');
  });

  it('rechaza búsqueda de sesión si el token es inválido o no existe', async () => {
    const result = await getScanSessionByToken('non-existent-token-000000000000000000000000000000000000000000000');
    expect(result).toBeNull();
  });

  it('móvil puede reclamar (claim) la sesión cambiando el estado a "connected"', async () => {
    const created = await createScanSession('empresa-123', 'user-456');
    const claim = await claimScanSession(created.token, {
      browser: 'Mobile Safari',
      os: 'iOS',
    }, 'user-mobile-789');

    expect(claim.session.status).toBe('connected');
    expect(claim.session.claimed_device_info).toEqual({
      browser: 'Mobile Safari',
      os: 'iOS',
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

  it('protección contra fuerza bruta de PIN: bloquea enumeración de PINs distintos desde el mismo actor', async () => {
    const created = await createScanSession('empresa-123', 'user-456');

    // Atacante intenta enumerar 5 PINs diferentes (000001..000005) desde el mismo actor/IP
    const actorDevice = { ip: '192.168.1.100', userAgent: 'AttackerBot/1.0' };
    for (let i = 1; i <= 5; i++) {
      const guessedPin = String(i).padStart(6, '0');
      await expect(
        claimScanSession({ pin: guessedPin }, actorDevice)
      ).rejects.toThrow(/código pin inválido/i);
    }

    // El 6to intento desde el mismo actor (incluso con el PIN correcto) debe ser bloqueado por lockout
    await expect(
      claimScanSession({ pin: created.session.pin_code! }, actorDevice)
    ).rejects.toThrow(/bloqueada|demasiados intentos/i);
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
    expect(completed.file_name).toBe('factura.pdf');
    expect(completed.page_count).toBe(3);
    expect(completed.file_size_bytes).toBe(450000);
    expect(completed.completed_at).toBeDefined();
  });

  it('SEGURIDAD & ANTI-REPLAY: mobileClaimToken queda inválido después de completion', async () => {
    const created = await createScanSession('empresa-123', null);
    const claim = await claimScanSession(created.token);

    await completeScanSession(claim.mobileClaimToken!, {
      storagePath: 'path1.pdf',
      fileName: 'doc1.pdf',
      fileSizeBytes: 1000,
      pageCount: 1,
    });

    // Segundo intento con el mobileClaimToken debe fallar (credencial invalidada)
    await expect(
      completeScanSession(claim.mobileClaimToken!, {
        storagePath: 'path2.pdf',
        fileName: 'doc2.pdf',
        fileSizeBytes: 2000,
        pageCount: 2,
      })
    ).rejects.toThrow(/completada|inválida/i);
  });

  it('SEGURIDAD: rechaza claim en sesiones expiradas', async () => {
    const created = await createScanSession('empresa-123', null, { ttlMinutes: -5 }); // ya expiró

    await expect(claimScanSession(created.token)).rejects.toThrow(
      'La sesión de escaneo ha expirado'
    );
  });
});
