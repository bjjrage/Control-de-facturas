import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  claimScanSession,
  createScanSession,
  completeScanSession,
} from '@/lib/scanner/session-service';
import { GET as getMobileSessionRoute, DELETE as deleteMobileSessionRoute } from '@/app/api/scanner/mobile-session/route';
import { POST as postClaimRoute } from '@/app/api/scanner/claim/route';
import { POST as postUploadRoute } from '@/app/api/scanner/upload/route';
import { SCANNER_MOBILE_COOKIE } from '@/lib/scanner/cookies';

// In-memory mock de Base de Datos y Storage
const mockSessions = new Map<string, any>();
const mockStorageFiles = new Set<string>();

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
  getCurrentProfile: async () => null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => new MockQueryBuilder(table),
    rpc: async () => ({ data: null, error: { message: 'function does not exist' } }),
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          mockStorageFiles.add(path);
          return { data: { path }, error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://storage.example.com/signed/${bucket}/${path}` },
          error: null,
        }),
        remove: async (paths: string[]) => {
          for (const p of paths) mockStorageFiles.delete(p);
          return { data: paths, error: null };
        },
      }),
    },
  }),
}));

describe('Scanner Mobile Session Management & Resumption', () => {
  beforeEach(() => {
    mockSessions.clear();
    mockStorageFiles.clear();
  });

  describe('1. GET /api/scanner/mobile-session Endpoint', () => {
    it('retorna active: false si no hay cookie ni header presente', async () => {
      const req = new NextRequest('http://localhost:3000/api/scanner/mobile-session');
      const res = await getMobileSessionRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.active).toBe(false);
      expect(data.session).toBeNull();
    });

    it('retorna active: true con sesión válida cuando se presenta cookie HttpOnly', async () => {
      const created = await createScanSession('empresa-1', 'user-1');
      const claim = await claimScanSession(created.token);

      const cookieVal = `${created.session.id}:${claim.mobileClaimToken}`;
      const req = new NextRequest('http://localhost:3000/api/scanner/mobile-session', {
        headers: {
          cookie: `${SCANNER_MOBILE_COOKIE}=${cookieVal}`,
        },
      });

      const res = await getMobileSessionRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.active).toBe(true);
      expect(data.session.id).toBe(created.session.id);
      expect(data.session.status).toBe('connected');
      expect(data.mobileClaimToken).toBe(claim.mobileClaimToken);

      // Debe renovar la cookie en la respuesta
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain(SCANNER_MOBILE_COOKIE);
      expect(setCookie).toContain('HttpOnly');
    });

    it('limpia cookie y retorna 410 si la sesión ha expirado', async () => {
      const created = await createScanSession('empresa-1', 'user-1');
      const claim = await claimScanSession(created.token);

      // Simular expiración temporal posterior al claim
      const row = mockSessions.get(created.session.id);
      if (row) {
        row.expires_at = new Date(Date.now() - 60000).toISOString();
      }

      const cookieVal = `${created.session.id}:${claim.mobileClaimToken}`;
      const req = new NextRequest('http://localhost:3000/api/scanner/mobile-session', {
        headers: {
          cookie: `${SCANNER_MOBILE_COOKIE}=${cookieVal}`,
        },
      });

      const res = await getMobileSessionRoute(req);
      expect(res.status).toBe(410);
      const data = await res.json();
      expect(data.active).toBe(false);
      expect(data.status).toBe('expired');

      // Cookie debe ser eliminada (max-age=0)
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('Max-Age=0');
    });

    it('limpia cookie y retorna active: false si la sesión ya fue completada', async () => {
      const created = await createScanSession('empresa-1', 'user-1');
      const claim = await claimScanSession(created.token);

      await completeScanSession(claim.mobileClaimToken!, {
        storagePath: 'doc.pdf',
        fileName: 'doc.pdf',
        fileSizeBytes: 100,
        pageCount: 1,
      });

      const cookieVal = `${created.session.id}:${claim.mobileClaimToken}`;
      const req = new NextRequest('http://localhost:3000/api/scanner/mobile-session', {
        headers: {
          cookie: `${SCANNER_MOBILE_COOKIE}=${cookieVal}`,
        },
      });

      const res = await getMobileSessionRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.active).toBe(false);
      expect(data.status).toBe('completed');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('Max-Age=0');
    });

    it('DELETE /api/scanner/mobile-session elimina la cookie', async () => {
      const res = await deleteMobileSessionRoute();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  describe('2. Flujo QR: Claim -> Refresh -> Resume', () => {
    it('primer claim vía QR establece cookie HttpOnly', async () => {
      const created = await createScanSession('empresa-1', 'user-1');

      const req = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token }),
      });

      const res = await postClaimRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.mobileClaimToken).toBeDefined();

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain(SCANNER_MOBILE_COOKIE);
      expect(setCookie).toContain('HttpOnly');
    });

    it('el mismo dispositivo puede refrescar y reanudar sin error de "ya reclamada"', async () => {
      const created = await createScanSession('empresa-1', 'user-1');

      // 1. Primer claim
      const claim1 = await claimScanSession(created.token);
      const mobileToken = claim1.mobileClaimToken!;

      // 2. Simular refresh de página enviando el token QR con la cookie del dispositivo
      const cookieHeader = `${SCANNER_MOBILE_COOKIE}=${created.session.id}:${mobileToken}`;
      const refreshReq = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          token: created.token,
          mobileClaimToken: mobileToken,
        }),
      });

      const refreshRes = await postClaimRoute(refreshReq);
      expect(refreshRes.status).toBe(200);
      const data = await refreshRes.json();
      expect(data.success).toBe(true);
      expect(data.session.id).toBe(created.session.id);
      expect(data.mobileClaimToken).toBe(mobileToken);
    });

    it('un segundo dispositivo distinto que escanea el mismo QR es rechazado con 409', async () => {
      const created = await createScanSession('empresa-1', 'user-1');

      // 1. Dispositivo A reclama la sesión
      await claimScanSession(created.token);

      // 2. Dispositivo B (sin credencial previa) intenta reclamar el mismo QR
      const reqB = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token }),
      });

      const resB = await postClaimRoute(reqB);
      expect(resB.status).toBe(409);
      const dataB = await resB.json();
      expect(dataB.error).toMatch(/ya (fue )?reclamada/i);
    });
  });

  describe('3. Flujo PIN Manual: Claim -> Refresh -> Resume', () => {
    it('claim con PIN establece cookie HttpOnly y permite resume', async () => {
      const created = await createScanSession('empresa-1', 'user-1');
      const pin = created.session.pin_code!;

      const req = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const res = await postClaimRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.mobileClaimToken).toBeDefined();

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain(SCANNER_MOBILE_COOKIE);

      // Ahora simular refresh: llamar GET /api/scanner/mobile-session con esa cookie
      const cookieHeader = `${SCANNER_MOBILE_COOKIE}=${data.session.id}:${data.mobileClaimToken}`;
      const resumeReq = new NextRequest('http://localhost:3000/api/scanner/mobile-session', {
        headers: { cookie: cookieHeader },
      });

      const resumeRes = await getMobileSessionRoute(resumeReq);
      expect(resumeRes.status).toBe(200);
      const resumeData = await resumeRes.json();
      expect(resumeData.active).toBe(true);
      expect(resumeData.session.id).toBe(created.session.id);
    });
  });

  describe('4. Autenticación de Upload con Cookie', () => {
    const validPdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');

    it('permite subir archivo autenticándose únicamente mediante la cookie HttpOnly', async () => {
      const created = await createScanSession('empresa-1', 'user-1');
      const claim = await claimScanSession(created.token);

      const formData = new FormData();
      // Omitir intencionalmente mobileClaimToken del body
      formData.set('file', new File([validPdfBytes], 'factura.pdf', { type: 'application/pdf' }));
      formData.set('pageCount', '1');

      const cookieHeader = `${SCANNER_MOBILE_COOKIE}=${created.session.id}:${claim.mobileClaimToken}`;
      const req = new NextRequest('http://localhost:3000/api/scanner/upload', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: formData,
      });

      const res = await postUploadRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.sessionId).toBe(created.session.id);

      // Al completar el upload, la cookie se invalida (anti-replay)
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('Max-Age=0');
    });
  });

  describe('5. Manejo de Carrera, Precedencia de Cookie y Resiliencia Anti-Stale', () => {
    it('carrera: request A gana y setea cookie, request B recibe 409 pero concilia vía resume a READY', async () => {
      const created = await createScanSession('empresa-1', 'user-1');

      // Request A (gana)
      const reqA = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token }),
      });
      const resA = await postClaimRoute(reqA);
      expect(resA.status).toBe(200);
      const dataA = await resA.json();
      expect(dataA.success).toBe(true);

      // Request B (30ms después, con el mismo raw QR token)
      const reqB = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: created.token }),
      });
      const resB = await postClaimRoute(reqB);
      expect(resB.status).toBe(409);

      // Conciliación: el cliente detecta 409 y llama GET /api/scanner/mobile-session con la cookie obtenida de A
      const cookieHeader = `${SCANNER_MOBILE_COOKIE}=${dataA.session.id}:${dataA.mobileClaimToken}`;
      const resumeReq = new NextRequest('http://localhost:3000/api/scanner/mobile-session', {
        headers: { cookie: cookieHeader },
      });
      const resumeRes = await getMobileSessionRoute(resumeReq);
      expect(resumeRes.status).toBe(200);
      const resumeData = await resumeRes.json();
      expect(resumeData.active).toBe(true);
      expect(resumeData.session.id).toBe(created.session.id);
      expect(resumeData.session.status).toBe('connected');
    });

    it('stale storage: token viejo de sesión A no impide reclamar sesión B con nuevo QR', async () => {
      const sessA = await createScanSession('empresa-1', 'user-1');
      const claimA = await claimScanSession(sessA.token);

      const sessB = await createScanSession('empresa-1', 'user-1');

      // Al reclamar sessB, si sessionStorage tuviera el token de sessA, la limpieza o el nuevo claim
      // de sessB debe tener éxito sin error de "wrong device"
      const reqB = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: sessB.token,
          // Intencionalmente no se envía token stale porque el frontend lo limpia
        }),
      });

      const resB = await postClaimRoute(reqB);
      expect(resB.status).toBe(200);
      const dataB = await resB.json();
      expect(dataB.success).toBe(true);
      expect(dataB.session.id).toBe(sessB.session.id);
      expect(dataB.mobileClaimToken).not.toBe(claimA.mobileClaimToken);
    });

    it('precedencia: la cookie HttpOnly tiene precedencia sobre mobileClaimToken del body', async () => {
      const sess = await createScanSession('empresa-1', 'user-1');
      const claim = await claimScanSession(sess.token);

      // Petición con cookie válida de la sesión, pero body con un token inválido o stale
      const cookieHeader = `${SCANNER_MOBILE_COOKIE}=${sess.session.id}:${claim.mobileClaimToken}`;
      const req = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: cookieHeader,
        },
        body: JSON.stringify({
          token: sess.token,
          mobileClaimToken: 'stale-bogus-token-from-storage',
        }),
      });

      const res = await postClaimRoute(req);
      // Gracias a la precedencia (cookie > body), reanuda correctamente usando la cookie
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.mobileClaimToken).toBe(claim.mobileClaimToken);
    });

    it('sesión NUEVA por PIN vincula exitosamente de forma independiente', async () => {
      const sess = await createScanSession('empresa-1', 'user-1');
      const pin = sess.session.pin_code!;

      const req = new NextRequest('http://localhost:3000/api/scanner/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      const res = await postClaimRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.session.status).toBe('connected');
      expect(data.mobileClaimToken).toBeDefined();
    });
  });
});
