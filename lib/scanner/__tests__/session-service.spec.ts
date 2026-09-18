import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  claimScanSession,
  completeScanSession,
  createScanSession,
  getScanSessionByToken,
  updateScanSessionStatus,
} from '../session-service';
import { hashScanToken } from '../tokens';

// In-memory mock de base de datos Supabase
const mockSessions = new Map<string, any>();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'scan_sessions') throw new Error(`Unexpected table ${table}`);
      return {
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              const id = 'session-uuid-' + Math.random().toString(36).slice(2, 9);
              const saved = { ...row, id, created_at: new Date().toISOString() };
              mockSessions.set(id, saved);
              return { data: saved, error: null };
            },
          }),
        }),
        select: () => ({
          eq: (field: string, val: any) => ({
            maybeSingle: async () => {
              for (const s of mockSessions.values()) {
                if (s[field] === val) return { data: { ...s }, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
        update: (updates: any) => ({
          eq: (field: string, val: any) => ({
            select: () => ({
              single: async () => {
                const s = mockSessions.get(val);
                if (!s) return { data: null, error: new Error('Not found') };
                const updated = { ...s, ...updates };
                mockSessions.set(val, updated);
                return { data: updated, error: null };
              },
            }),
          }),
        }),
      };
    },
  }),
}));

describe('Scanner Session Service Lifecycle', () => {
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

  it('permite transicionar el estado a "scanning" y "processing"', async () => {
    const created = await createScanSession('empresa-123', null);
    await claimScanSession(created.token);

    const s1 = await updateScanSessionStatus(created.token, 'scanning');
    expect(s1.status).toBe('scanning');

    const s2 = await updateScanSessionStatus(created.token, 'processing');
    expect(s2.status).toBe('processing');
  });

  it('finaliza la sesión con el documento asociado y metadata completa', async () => {
    const created = await createScanSession('empresa-123', null);
    await claimScanSession(created.token);

    const completed = await completeScanSession(created.token, {
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

  it('SEGURIDAD & ANTI-REPLAY: bloquea completar una sesión ya completada', async () => {
    const created = await createScanSession('empresa-123', null);
    await claimScanSession(created.token);

    await completeScanSession(created.token, {
      storagePath: 'path1.pdf',
      fileName: 'doc1.pdf',
      fileSizeBytes: 1000,
      pageCount: 1,
    });

    // Segundo intento con el mismo token debe fallar
    await expect(
      completeScanSession(created.token, {
        storagePath: 'path2.pdf',
        fileName: 'doc2.pdf',
        fileSizeBytes: 2000,
        pageCount: 2,
      })
    ).rejects.toThrow('Esta sesión ya fue completada previamente (anti-replay)');
  });

  it('SEGURIDAD: rechaza claim en sesiones expiradas', async () => {
    const created = await createScanSession('empresa-123', null, { ttlMinutes: -5 }); // ya expiró

    await expect(claimScanSession(created.token)).rejects.toThrow(
      'La sesión de escaneo ha expirado'
    );
  });
});
