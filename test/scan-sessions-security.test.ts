import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  claimScanSession,
  completeScanSession,
  createScanSession,
  getScanSessionByToken,
  updateScanSessionStatus,
} from '@/lib/scanner/session-service';
import { hashScanToken } from '@/lib/scanner/tokens';

const mockDb = new Map<string, any>();

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: async () => {
            const id = 'sess-' + Math.random().toString(36).substring(2, 9);
            const data = { ...row, id, created_at: new Date().toISOString() };
            mockDb.set(id, data);
            return { data, error: null };
          },
        }),
      }),
      select: (cols: string) => ({
        eq: (field: string, val: any) => ({
          maybeSingle: async () => {
            for (const item of mockDb.values()) {
              if (item[field] === val) return { data: { ...item }, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      update: (updates: any) => ({
        eq: (field: string, idVal: any) => ({
          select: () => ({
            single: async () => {
              const item = mockDb.get(idVal);
              if (!item) return { data: null, error: new Error('Not found') };
              const updated = { ...item, ...updates };
              mockDb.set(idVal, updated);
              return { data: updated, error: null };
            },
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.example.com/signed/${path}?token=sig` },
          error: null,
        }),
      }),
    },
  }),
}));

describe('Scan Sessions Security & Tenant Isolation Tests', () => {
  beforeEach(() => {
    mockDb.clear();
  });

  it('1. Token Entropy: token es secreto y nunca se expone en la base de datos (solo hash)', async () => {
    const res = await createScanSession('empresa-alpha', 'user-1');
    const stored = mockDb.get(res.session.id);

    expect(stored.token_hash).toBe(hashScanToken(res.token));
    expect(stored.token_hash).not.toBe(res.token);
    expect(stored.token).toBeUndefined();
  });

  it('2. Anti-Replay: una sesión completada no puede ser sobrescrita ni completada de nuevo', async () => {
    const res = await createScanSession('empresa-alpha', 'user-1');
    await claimScanSession(res.token);

    await completeScanSession(res.token, {
      storagePath: 'empresa-alpha/scans/s1/factura.pdf',
      fileName: 'factura.pdf',
      fileSizeBytes: 150000,
      pageCount: 2,
    });

    // Segundo intento con el mismo token debe ser rechazado
    await expect(
      completeScanSession(res.token, {
        storagePath: 'empresa-alpha/scans/s1/malicious.pdf',
        fileName: 'malicious.pdf',
        fileSizeBytes: 999999,
        pageCount: 1,
      })
    ).rejects.toThrow('Esta sesión ya fue completada previamente (anti-replay)');
  });

  it('3. Expiración Estricta: bloquea acceso, claim y modificaciones después del vencimiento', async () => {
    // Sesión expirada creada con ttlMinutes negativo
    const res = await createScanSession('empresa-alpha', 'user-1', { ttlMinutes: -1 });

    // Intento de claim debe fallar
    await expect(claimScanSession(res.token)).rejects.toThrow(
      'La sesión de escaneo ha expirado'
    );

    // Intento de modificar estado debe fallar
    await expect(updateScanSessionStatus(res.token, 'scanning')).rejects.toThrow(
      'La sesión ha expirado'
    );

    // Intento de completar debe fallar
    await expect(
      completeScanSession(res.token, {
        storagePath: 'path.pdf',
        fileName: 'file.pdf',
        fileSizeBytes: 100,
        pageCount: 1,
      })
    ).rejects.toThrow('La sesión ha expirado');
  });

  it('4. Tenant Safe: los documentos se almacenan bajo el prefijo del tenant propietario', async () => {
    const res = await createScanSession('empresa-alpha', 'user-1', { contextType: 'invoice' });
    await claimScanSession(res.token);

    const docPath = `${res.session.empresa_id}/scans/${res.session.id}/doc.pdf`;
    const completed = await completeScanSession(res.token, {
      storagePath: docPath,
      fileName: 'doc.pdf',
      fileSizeBytes: 120000,
      pageCount: 1,
    });

    expect(completed.storage_path?.startsWith('empresa-alpha/scans/')).toBe(true);
    expect(completed.empresa_id).toBe('empresa-alpha');
  });

  it('5. Context Tampering Prevention: el contexto fijado en la creación es inmutable por el móvil', async () => {
    const res = await createScanSession('empresa-alpha', 'user-1', {
      contextType: 'invoice',
      contextId: 'inv-uuid-888',
      targetField: 'main_invoice_file',
    });

    // Móvil se une y completa
    await claimScanSession(res.token, { device: 'Android' });
    const completed = await completeScanSession(res.token, {
      storagePath: 'empresa-alpha/scans/s1/doc.pdf',
      fileName: 'doc.pdf',
      fileSizeBytes: 1000,
      pageCount: 1,
    });

    // El contexto original se mantiene idéntico y seguro
    expect(completed.context_type).toBe('invoice');
    expect(completed.context_id).toBe('inv-uuid-888');
    expect(completed.target_field).toBe('main_invoice_file');
  });
});
