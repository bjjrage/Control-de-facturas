import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  claimScanSession,
  completeScanSession,
  createScanSession,
  getScanSessionByCredential,
  getScanSessionByToken,
} from '@/lib/scanner/session-service';
import { hashScanToken } from '@/lib/scanner/tokens';
import { GET as getStatusRoute } from '@/app/api/scanner/status/[id]/route';
import { POST as postUploadRoute } from '@/app/api/scanner/upload/route';

// In-memory mock de Base de Datos y Storage
const mockSessions = new Map<string, any>();
const mockStorageFiles = new Set<string>();
const storageRemovedFiles: string[] = [];

let currentMockProfile: { id: string; empresa_id: string; role: string } | null = null;
let forceUploadConflict = false;
let forceCompleteFailure = false;

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

  order(_field: string, _opts?: { ascending?: boolean }) {
    return this;
  }

  limit(_count: number) {
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
      const id = 'sess-' + Math.random().toString(36).substring(2, 9);
      const row = { ...this.insertData, id, created_at: new Date().toISOString() };
      mockSessions.set(id, row);
      return { data: row, error: null };
    }

    if (this.isUpdate) {
      if (forceCompleteFailure) {
        return { data: null, error: new Error('Simulated CAS race failure') };
      }
      let updatedRow: any = null;
      for (const [id, row] of mockSessions.entries()) {
        if (this.filters.every((f) => f(row))) {
          updatedRow = { ...row, ...this.updateData };
          mockSessions.set(id, updatedRow);
          break;
        }
      }
      if (!updatedRow) {
        return strict ? { data: null, error: new Error('Not found') } : { data: null, error: null };
      }
      return { data: updatedRow, error: null };
    }

    // Select
    for (const row of mockSessions.values()) {
      if (this.filters.every((f) => f(row))) {
        return { data: { ...row }, error: null };
      }
    }
    return strict ? { data: null, error: new Error('Not found') } : { data: null, error: null };
  }
}

vi.mock('@/lib/auth', () => ({
  getCurrentProfile: async () => currentMockProfile,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      return new MockQueryBuilder(table);
    },
    rpc: async () => {
      // Fallback a compare-and-set para probar la lógica TypeScript
      return { data: null, error: { message: 'function does not exist' } };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array, opts: any) => {
          if (forceUploadConflict || mockStorageFiles.has(path)) {
            return { data: null, error: new Error('The resource already exists (409 Duplicate)') };
          }
          mockStorageFiles.add(path);
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.example.com/signed/${bucket}/${path}?expires=300` },
          error: null,
        }),
        remove: async (paths: string[]) => {
          for (const p of paths) {
            mockStorageFiles.delete(p);
            storageRemovedFiles.push(p);
          }
          return { data: paths, error: null };
        },
      }),
    },
  }),
}));

describe('Scan Sessions Security, Tenant Isolation & Token Hardening', () => {
  beforeEach(() => {
    mockSessions.clear();
    mockStorageFiles.clear();
    storageRemovedFiles.length = 0;
    currentMockProfile = null;
    forceUploadConflict = false;
  });

  describe('1. Endpoint /api/scanner/status/[id] Tenant Isolation', () => {
    it('rechaza con 401 a clientes no autenticados en el ERP', async () => {
      currentMockProfile = null; // No logueado
      const req = new NextRequest('http://localhost:3000/api/scanner/status/some-session-id');
      const res = await getStatusRoute(req, {
        params: Promise.resolve({ id: 'some-session-id' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/no autorizado/i);
    });

    it('devuelve 404 (fail-closed) si un usuario autenticado del Tenant B intenta acceder a sesión del Tenant A', async () => {
      // Crear sesión perteneciente a Empresa A
      const sessionA = await createScanSession('empresa-A', 'user-A1');

      // Usuario autenticado pertenece a Empresa B
      currentMockProfile = {
        id: 'user-B1',
        empresa_id: 'empresa-B',
        role: 'admin',
      };

      const req = new NextRequest(`http://localhost:3000/api/scanner/status/${sessionA.session.id}`);
      const res = await getStatusRoute(req, {
        params: Promise.resolve({ id: sessionA.session.id }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/no encontrada/i);
    });

    it('devuelve 200 y NO incluye signed_url si la sesión no está completada', async () => {
      const sessionA = await createScanSession('empresa-A', 'user-A1');
      currentMockProfile = {
        id: 'user-A1',
        empresa_id: 'empresa-A',
        role: 'user',
      };

      const req = new NextRequest(`http://localhost:3000/api/scanner/status/${sessionA.session.id}`);
      const res = await getStatusRoute(req, {
        params: Promise.resolve({ id: sessionA.session.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(sessionA.session.id);
      expect(body.status).toBe('waiting');
      expect(body.signed_url).toBeNull();
    });

    it('devuelve 200 con signed_url temporal ÚNICAMENTE cuando la sesión está completada por el tenant dueño', async () => {
      const sessionA = await createScanSession('empresa-A', 'user-A1');
      const claim = await claimScanSession(sessionA.token);
      await completeScanSession(claim.mobileClaimToken!, {
        storagePath: 'empresa-A/scans/s1/factura.pdf',
        fileName: 'factura.pdf',
        fileSizeBytes: 2048,
        pageCount: 1,
      });

      currentMockProfile = {
        id: 'user-A1',
        empresa_id: 'empresa-A',
        role: 'user',
      };

      const req = new NextRequest(`http://localhost:3000/api/scanner/status/${sessionA.session.id}`);
      const res = await getStatusRoute(req, {
        params: Promise.resolve({ id: sessionA.session.id }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('completed');
      expect(body.signed_url).toContain('https://storage.example.com/signed/');
      expect(body.storage_path).toBe('empresa-A/scans/s1/factura.pdf');
    });
  });

  describe('2. Mobile Claim Token Lifecycle & QR Token Invalidation', () => {
    it('el QR token original es CLAIM-ONLY: queda invalidado tras el claim y no puede operar', async () => {
      const created = await createScanSession('empresa-A', 'user-A1');
      const claim = await claimScanSession(created.token);

      expect(claim.mobileClaimToken).toBeDefined();

      // El QR token original NO debe poder resolver la sesión
      const byQr = await getScanSessionByToken(created.token);
      expect(byQr).toBeNull();

      // El QR token original no puede realizar operaciones post-claim
      await expect(
        completeScanSession(created.token, {
          storagePath: 'path.pdf',
          fileName: 'f.pdf',
          fileSizeBytes: 100,
          pageCount: 1,
        })
      ).rejects.toThrow(/sesión no encontrada|inválida/i);
    });

    it('mobileClaimToken queda invalidado tras completion (Anti-Replay)', async () => {
      const created = await createScanSession('empresa-A', 'user-A1');
      const claim = await claimScanSession(created.token);

      await completeScanSession(claim.mobileClaimToken!, {
        storagePath: 'empresa-A/scans/factura.pdf',
        fileName: 'factura.pdf',
        fileSizeBytes: 1024,
        pageCount: 1,
      });

      // Segundo intento con mobileClaimToken debe fallar
      await expect(
        completeScanSession(claim.mobileClaimToken!, {
          storagePath: 'empresa-A/scans/hack.pdf',
          fileName: 'hack.pdf',
          fileSizeBytes: 9999,
          pageCount: 1,
        })
      ).rejects.toThrow(/sesión no encontrada|inválida/i);
    });
  });

  describe('3. Endpoint /api/scanner/upload Credential Validation & Conflict Handling', () => {
    const validPdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    it('rechaza explícitamente tokenHash como credencial de cliente con 400 Bad Request', async () => {
      const formData = new FormData();
      formData.set('tokenHash', 'some-leaked-hash');
      formData.set('file', new File([validPdfBytes], 'factura.pdf', { type: 'application/pdf' }));

      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/tokenHash no es una credencial/i);
    });

    it('rechaza subida con el QR token inicial si no se presenta mobileClaimToken con 401', async () => {
      const created = await createScanSession('empresa-A', 'user-A1');

      const formData = new FormData();
      formData.set('token', created.token);
      formData.set('file', new File([validPdfBytes], 'factura.pdf', { type: 'application/pdf' }));

      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toMatch(/el token qr inicial no es válido/i);
    });

    it('rechaza subidas de archivos que no sean PDF válidos (%PDF- magic bytes)', async () => {
      const created = await createScanSession('empresa-A', 'user-A1');
      const claim = await claimScanSession(created.token);

      const fakeFile = new File(['GIF89a corrupted file'], 'factura.pdf', { type: 'application/pdf' });
      const formData = new FormData();
      formData.set('mobileClaimToken', claim.mobileClaimToken!);
      formData.set('file', fakeFile);

      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/no es un documento pdf válido/i);
    });

    it('subida exitosa: almacena en path tenant-safe y completa sesión', async () => {
      const created = await createScanSession('empresa-Alpha', 'user-A1');
      const claim = await claimScanSession(created.token);

      const formData = new FormData();
      formData.set('mobileClaimToken', claim.mobileClaimToken!);
      formData.set('file', new File([validPdfBytes], 'factura_001.pdf', { type: 'application/pdf' }));
      formData.set('pageCount', '1');

      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.storagePath).toMatch(/^empresa-Alpha\/scans\//);
      expect(body.signedUrl).toBeDefined();
    });

    it('rechaza con 409 Conflict si el storage ya tiene el archivo existente (already exists)', async () => {
      const created = await createScanSession('empresa-Alpha', 'user-A1');
      const claim = await claimScanSession(created.token);

      forceUploadConflict = true;

      const formData = new FormData();
      formData.set('mobileClaimToken', claim.mobileClaimToken!);
      formData.set('file', new File([validPdfBytes], 'factura.pdf', { type: 'application/pdf' }));

      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/ya existe o hay otra subida/i);
    });

    it('limpieza de archivo huérfano si el CAS de completion falla o pierde carrera', async () => {
      const created = await createScanSession('empresa-Alpha', 'user-A1');
      const claim = await claimScanSession(created.token);

      // Simular que el CAS de completion falla tras haber subido el archivo a storage
      forceCompleteFailure = true;

      const formData = new FormData();
      formData.set('mobileClaimToken', claim.mobileClaimToken!);
      formData.set('file', new File([validPdfBytes], 'factura.pdf', { type: 'application/pdf' }));

      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(409);

      // El archivo que se subió debe haber sido eliminado (orphan cleanup)
      expect(storageRemovedFiles.length).toBeGreaterThan(0);
      expect(storageRemovedFiles[0]).toMatch(/^empresa-Alpha\/scans\//);
    });
  });

  describe('4. Expiración Estricta', () => {
    it('bloquea claim en sesiones con TTL expirado', async () => {
      const expiredSession = await createScanSession('empresa-A', 'user-A1', { ttlMinutes: -5 });

      await expect(claimScanSession(expiredSession.token)).rejects.toThrow(
        /expirado/i
      );
    });
  });
});
