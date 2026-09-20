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
    from: (table: string) => ({
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
    }),
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
    mockAttachmentsInserted.length = 0;
    mockInvoicesInserted.length = 0;
    mockStorageUploadCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asocia directamente scanner_storage_path como attachment sin re-subir el PDF a storage', async () => {
    const formData = new FormData();
    formData.set('provider_id', 'provider-abc-123');
    formData.set('invoice_number', '001-001-0004567');
    formData.set('invoice_date', '2026-09-20');
    formData.set('currency', 'PYG');
    formData.set('total', '150000');
    // Metadatos enviados por la integración de Control Scanner
    formData.set('scanner_storage_path', 'empresa-tenant-111/scans/session-xyz/factura-escaneada.pdf');
    formData.set('scanner_file_name', 'factura-escaneada.pdf');
    formData.set('scanner_file_size', '452100');

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
