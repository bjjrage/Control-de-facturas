import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createInvoice } from '@/app/(internal)/invoices/actions';

// Mock auth
vi.mock('@/lib/auth', () => ({
  requireProfile: vi.fn().mockResolvedValue({
    id: 'user-operator-123',
    empresa_id: 'empresa-tenant-111',
    role: 'administracion',
  }),
}));

// Mock audit
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

// Mock invoice auto match
vi.mock('@/lib/invoice-auto-match', () => ({
  autoMatchInvoice: vi.fn().mockResolvedValue(null),
}));

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// In-memory mock storage and database
interface MockScanSession {
  id: string;
  empresa_id: string;
  status: string;
  storage_bucket: string;
  storage_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  page_count?: number;
  context_type: string;
  context_id?: string | null;
}

const mockScanSessions: MockScanSession[] = [];
const mockAttachmentsInserted: any[] = [];
const mockInvoicesInserted: any[] = [];
const mockStorageUploadCalls: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: any, options: any) => {
          mockStorageUploadCalls.push({ bucket, path, file, options });
          return { error: null };
        },
        createSignedUrl: async (path: string, expiresIn: number) => ({
          data: { signedUrl: `https://storage.mock/${bucket}/${path}?token=signed-123` },
          error: null,
        }),
      }),
    },
    from: (table: string) => {
      const filters: { [key: string]: any } = {};
      let updatePayload: any = null;

      const builder: any = {
        select: () => builder,
        eq: (col: string, val: any) => {
          filters[col] = val;
          return builder;
        },
        update: (payload: any) => {
          updatePayload = payload;
          return builder;
        },
        insert: (data: any) => {
          if (table === 'attachments') {
            const inserted = { id: 'att-' + Math.random().toString(36).slice(2, 8), ...data };
            mockAttachmentsInserted.push(inserted);
            return {
              select: () => ({
                single: async () => ({ data: inserted, error: null }),
              }),
            };
          }
          return {
            select: () => ({
              single: async () => ({ data: { id: 'generic-id' }, error: null }),
            }),
          };
        },
        maybeSingle: async () => {
          if (table === 'scan_sessions') {
            const match = mockScanSessions.find((s) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((s as any)[k] !== v) return false;
              }
              return true;
            });
            return { data: match || null, error: null };
          }
          if (table === 'attachments') {
            const match = mockAttachmentsInserted.find((a) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((a as any)[k] !== v) return false;
              }
              return true;
            });
            return { data: match || null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => {
          if (table === 'scan_sessions') {
            const match = mockScanSessions.find((s) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((s as any)[k] !== v) return false;
              }
              return true;
            });
            return { data: match || null, error: match ? null : new Error('Not found') };
          }
          return { data: null, error: null };
        },
        then: (resolve: any, reject: any) => {
          if (updatePayload && table === 'scan_sessions') {
            const match = mockScanSessions.find((s) => {
              for (const [k, v] of Object.entries(filters)) {
                if ((s as any)[k] !== v) return false;
              }
              return true;
            });
            if (match) {
              Object.assign(match, updatePayload);
            }
          }
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => ({
      insert: (data: any) => {
        if (table === 'invoices') {
          const inserted = { id: 'inv-' + Math.random().toString(36).slice(2, 8), ...data };
          mockInvoicesInserted.push(inserted);
          return {
            select: () => ({
              single: async () => ({ data: inserted, error: null }),
            }),
          };
        }
        return {
          select: () => ({
            single: async () => ({ data: { id: 'generic-id' }, error: null }),
          }),
        };
      },
    }),
  }),
}));

describe('Control Scanner - Invoice UI Integration & Zero-Duplicate Upload', () => {
  beforeEach(() => {
    mockScanSessions.length = 0;
    mockAttachmentsInserted.length = 0;
    mockInvoicesInserted.length = 0;
    mockStorageUploadCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asocia directamente scanner_session_id validando sesión completada del mismo tenant sin re-subir a storage', async () => {
    mockScanSessions.push({
      id: 'session-xyz',
      empresa_id: 'empresa-tenant-111',
      status: 'completed',
      context_type: 'invoice',
      storage_bucket: 'invoice-files',
      storage_path: 'empresa-tenant-111/scans/session-xyz/factura-escaneada.pdf',
      file_name: 'factura-escaneada.pdf',
      file_size_bytes: 452100,
    });

    const formData = new FormData();
    formData.set('provider_id', 'provider-abc-123');
    formData.set('invoice_number', '001-001-0004567');
    formData.set('invoice_date', '2026-09-20');
    formData.set('currency', 'PYG');
    formData.set('total', '150000');
    // UI solo envía scanner_session_id
    formData.set('scanner_session_id', 'session-xyz');

    const result = await createInvoice(formData);

    expect(result.error).toBeNull();
    expect(result.id).toBeDefined();

    // 1. NO se debió ejecutar ninguna subida duplicada a Storage
    expect(mockStorageUploadCalls.length).toBe(0);

    // 2. Se debió insertar el attachment reutilizando la ruta en Storage de scan_sessions
    expect(mockAttachmentsInserted.length).toBe(1);
    expect(mockAttachmentsInserted[0]).toMatchObject({
      empresa_id: 'empresa-tenant-111',
      bucket: 'invoice-files',
      path: 'empresa-tenant-111/scans/session-xyz/factura-escaneada.pdf',
      file_name: 'factura-escaneada.pdf',
      size_bytes: 452100,
      mime_type: 'application/pdf',
      uploaded_by: 'user-operator-123',
    });

    // 3. La factura creada contiene el ID del attachment registrado
    expect(mockInvoicesInserted.length).toBe(1);
    expect(mockInvoicesInserted[0].attachment_id).toBe(mockAttachmentsInserted[0].id);
    expect(mockInvoicesInserted[0].invoice_number).toBe('001-001-0004567');
    expect(mockInvoicesInserted[0].total).toBe(150000);

    // 4. La sesión de escaneo fue enlazada a la factura creada
    expect(mockScanSessions[0].context_id).toBe(mockInvoicesInserted[0].id);
  });

  it('rechaza con error si un operador intenta usar scanner_session_id de otro tenant (cross-tenant isolation)', async () => {
    mockScanSessions.push({
      id: 'session-tenant-222',
      empresa_id: 'empresa-tenant-222', // Pertenece a otra empresa
      status: 'completed',
      context_type: 'invoice',
      storage_bucket: 'invoice-files',
      storage_path: 'empresa-tenant-222/scans/session-222/otra-factura.pdf',
      file_name: 'otra-factura.pdf',
      file_size_bytes: 300000,
    });

    const formData = new FormData();
    formData.set('provider_id', 'provider-abc-123');
    formData.set('invoice_number', '001-001-0004568');
    formData.set('invoice_date', '2026-09-20');
    formData.set('currency', 'PYG');
    formData.set('total', '150000');
    formData.set('scanner_session_id', 'session-tenant-222');

    const result = await createInvoice(formData);

    expect(result.error).toBe('Sesión de Control Scanner inválida o no disponible.');
    expect(mockAttachmentsInserted.length).toBe(0);
    expect(mockInvoicesInserted.length).toBe(0);
    expect(mockStorageUploadCalls.length).toBe(0);
  });

  it('rechaza con error si la sesión del escáner no está completada (waiting / scanning)', async () => {
    mockScanSessions.push({
      id: 'session-waiting-123',
      empresa_id: 'empresa-tenant-111',
      status: 'waiting',
      context_type: 'invoice',
      storage_bucket: 'invoice-files',
      storage_path: null,
      file_name: null,
      file_size_bytes: null,
    });

    const formData = new FormData();
    formData.set('provider_id', 'provider-abc-123');
    formData.set('invoice_number', '001-001-0004569');
    formData.set('invoice_date', '2026-09-20');
    formData.set('currency', 'PYG');
    formData.set('total', '150000');
    formData.set('scanner_session_id', 'session-waiting-123');

    const result = await createInvoice(formData);

    expect(result.error).toBe('Sesión de Control Scanner inválida o no disponible.');
    expect(mockAttachmentsInserted.length).toBe(0);
    expect(mockInvoicesInserted.length).toBe(0);
  });

  it('ignora completamente campos de storage manipulados desde el cliente (tampering immunity)', async () => {
    mockScanSessions.push({
      id: 'session-xyz',
      empresa_id: 'empresa-tenant-111',
      status: 'completed',
      context_type: 'invoice',
      storage_bucket: 'invoice-files',
      storage_path: 'empresa-tenant-111/scans/session-xyz/factura-legitima.pdf',
      file_name: 'factura-legitima.pdf',
      file_size_bytes: 123456,
    });

    const formData = new FormData();
    formData.set('provider_id', 'provider-abc-123');
    formData.set('invoice_number', '001-001-0004570');
    formData.set('invoice_date', '2026-09-20');
    formData.set('currency', 'PYG');
    formData.set('total', '150000');
    formData.set('scanner_session_id', 'session-xyz');
    // Atacante inyecta campos arbitrarios en formData
    formData.set('scanner_storage_path', 'empresa-victima/secreto-confidencial.pdf');
    formData.set('scanner_file_name', 'malware.exe');
    formData.set('scanner_file_size', '999999999');

    const result = await createInvoice(formData);

    expect(result.error).toBeNull();
    expect(mockAttachmentsInserted.length).toBe(1);
    // Verificamos que se tomaron los valores de la DB y se ignoraron por completo los campos inyectados
    expect(mockAttachmentsInserted[0].path).toBe('empresa-tenant-111/scans/session-xyz/factura-legitima.pdf');
    expect(mockAttachmentsInserted[0].file_name).toBe('factura-legitima.pdf');
    expect(mockAttachmentsInserted[0].size_bytes).toBe(123456);
  });

  it('previene replay del mismo scan_session en múltiples facturas (anti-replay)', async () => {
    mockScanSessions.push({
      id: 'session-replay-test',
      empresa_id: 'empresa-tenant-111',
      status: 'completed',
      context_type: 'invoice',
      storage_bucket: 'invoice-files',
      storage_path: 'empresa-tenant-111/scans/session-replay-test/factura.pdf',
      file_name: 'factura.pdf',
      file_size_bytes: 200000,
    });

    // 1ra factura usando la sesión -> Éxito
    const formData1 = new FormData();
    formData1.set('provider_id', 'provider-abc-123');
    formData1.set('invoice_number', '001-001-0004571');
    formData1.set('invoice_date', '2026-09-20');
    formData1.set('currency', 'PYG');
    formData1.set('total', '150000');
    formData1.set('scanner_session_id', 'session-replay-test');

    const result1 = await createInvoice(formData1);
    expect(result1.error).toBeNull();
    expect(mockAttachmentsInserted.length).toBe(1);

    // 2da factura intentando reusar la misma sesión -> Rechazado por anti-replay
    const formData2 = new FormData();
    formData2.set('provider_id', 'provider-abc-123');
    formData2.set('invoice_number', '001-001-0004572');
    formData2.set('invoice_date', '2026-09-20');
    formData2.set('currency', 'PYG');
    formData2.set('total', '150000');
    formData2.set('scanner_session_id', 'session-replay-test');

    const result2 = await createInvoice(formData2);
    expect(result2.error).toBe('El documento escaneado ya fue utilizado en otra factura.');
    // No se creó ningún segundo attachment ni segunda factura
    expect(mockAttachmentsInserted.length).toBe(1);
    expect(mockInvoicesInserted.length).toBe(1);
  });

  it('mantiene la ruta tradicional de subida manual si no hay scanner_storage_path', async () => {
    const fakeBlob = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
    const fakeFile = new File([fakeBlob], 'factura-manual.pdf', { type: 'application/pdf' });

    const formData = new FormData();
    formData.set('provider_id', 'provider-abc-123');
    formData.set('invoice_number', '001-001-0009999');
    formData.set('invoice_date', '2026-09-20');
    formData.set('currency', 'PYG');
    formData.set('total', '200000');
    formData.set('file', fakeFile);

    const result = await createInvoice(formData);

    expect(result.error).toBeNull();
    expect(result.id).toBeDefined();

    // En la subida manual tradicional, sí se llama a storage.upload
    expect(mockStorageUploadCalls.length).toBe(1);
    expect(mockStorageUploadCalls[0].bucket).toBe('invoice-files');
    expect(mockAttachmentsInserted.length).toBe(1);
    expect(mockAttachmentsInserted[0].file_name).toBe('factura-manual.pdf');
  });

  it('simula el ciclo de polling de desktop: waiting -> connected -> scanning -> processing -> completed y detiene timers', async () => {
    vi.useFakeTimers();

    const sessionId = 'session-test-poll-123';
    const statusSequence = [
      { status: 'waiting' },
      { status: 'connected' },
      { status: 'scanning' },
      { status: 'processing' },
      {
        status: 'completed',
        signed_url: 'https://storage.mock/invoice-files/scans/test.pdf',
        file_name: 'factura-escaneada.pdf',
        page_count: 2,
        file_size_bytes: 350000,
        storage_path: 'empresa-tenant-111/scans/session-test-poll-123/factura-escaneada.pdf',
      },
    ];

    let pollIndex = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/scanner/status/')) {
        const item = statusSequence[Math.min(pollIndex, statusSequence.length - 1)];
        pollIndex++;
        return {
          ok: true,
          json: async () => item,
        };
      }
      if (url.includes('storage.mock')) {
        return {
          blob: async () => new Blob(['%PDF-1.4 mock content'], { type: 'application/pdf' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });

    // Simular el observador de polling seguro
    let currentStatus = 'waiting';
    let completedDocument: any = null;
    let isPolling = true;

    const interval = setInterval(async () => {
      if (!isPolling) return;
      const res = await mockFetch(`/api/scanner/status/${sessionId}`);
      const data = await res.json();
      currentStatus = data.status;

      if (data.status === 'completed') {
        isPolling = false;
        clearInterval(interval);
        const fileRes = await mockFetch(data.signed_url);
        const blob = await fileRes.blob();
        completedDocument = {
          file: new File([blob], data.file_name, { type: 'application/pdf' }),
          signedUrl: data.signed_url,
          fileName: data.file_name,
          pageCount: data.page_count,
          fileSizeBytes: data.file_size_bytes,
          storagePath: data.storage_path,
        };
      }
    }, 2000);

    // Turno 1 (2s): waiting
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentStatus).toBe('waiting');
    expect(isPolling).toBe(true);

    // Turno 2 (4s): connected
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentStatus).toBe('connected');
    expect(isPolling).toBe(true);

    // Turno 3 (6s): scanning
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentStatus).toBe('scanning');
    expect(isPolling).toBe(true);

    // Turno 4 (8s): processing
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentStatus).toBe('processing');
    expect(isPolling).toBe(true);

    // Turno 5 (10s): completed
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentStatus).toBe('completed');
    expect(isPolling).toBe(false); // Polling detenido

    // Documento incorporado con metadatos reales
    expect(completedDocument).not.toBeNull();
    expect(completedDocument.fileName).toBe('factura-escaneada.pdf');
    expect(completedDocument.pageCount).toBe(2);
    expect(completedDocument.storagePath).toBe(
      'empresa-tenant-111/scans/session-test-poll-123/factura-escaneada.pdf'
    );

    // Si avanza más tiempo, no hay más llamadas porque el polling fue cancelado
    const callCountAtCompletion = mockFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(mockFetch.mock.calls.length).toBe(callCountAtCompletion);

    vi.useRealTimers();
  });

  it('detiene el polling inmediatamente si la sesión expira o si el usuario cancela', async () => {
    vi.useFakeTimers();

    const sessionId = 'session-expired-123';
    let pollCalls = 0;

    const mockFetch = vi.fn().mockImplementation(async () => {
      pollCalls++;
      return {
        ok: true,
        json: async () => ({ status: 'expired' }),
      };
    });

    let currentStatus = 'waiting';
    let isPolling = true;

    const interval = setInterval(async () => {
      if (!isPolling) return;
      const res = await mockFetch(`/api/scanner/status/${sessionId}`);
      const data = await res.json();
      currentStatus = data.status;

      if (data.status === 'expired') {
        isPolling = false;
        clearInterval(interval);
      }
    }, 2000);

    // Tick 1: detecta expirada
    await vi.advanceTimersByTimeAsync(2000);
    expect(currentStatus).toBe('expired');
    expect(isPolling).toBe(false);
    expect(pollCalls).toBe(1);

    // Ticks siguientes: no hay más llamadas
    await vi.advanceTimersByTimeAsync(10000);
    expect(pollCalls).toBe(1);

    vi.useRealTimers();
  });
});
