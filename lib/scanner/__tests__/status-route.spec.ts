import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  session: null as Record<string, unknown> | null,
  signedUrl: vi.fn(),
  filters: {} as Record<string, unknown>,
  createSession: vi.fn(),
}));

type Query = {
  select: (...args: unknown[]) => Query;
  eq: (column: string, value: unknown) => Query;
  maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
};

vi.mock("@/lib/auth", () => ({
  getCurrentProfile: vi.fn(async () => mocks.profile),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => {
      const query: Query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          mocks.filters[column] = value;
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data: Object.entries(mocks.filters).every(([key, value]) => mocks.session?.[key] === value)
            ? mocks.session
            : null,
          error: null,
        })),
      };
      return query;
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        createSignedUrl: mocks.signedUrl.mockImplementation(async (path: string) => ({
          data: { signedUrl: `https://signed.invalid/${bucket}/${path}` },
        })),
      })),
    },
  })),
}));

vi.mock("@/lib/scanner/session-service", () => ({
  createScanSession: mocks.createSession,
}));

import { GET } from "@/app/api/scanner/status/[id]/route";
import { POST } from "@/app/api/scanner/session/route";

const tenant = "00000000-0000-4000-8000-000000000001";
const owner = "00000000-0000-4000-8000-000000000011";
const sessionId = "00000000-0000-4000-8000-000000000021";

function profile(role: string, id = owner, empresaId = tenant) {
  return { id, empresa_id: empresaId, role, active: true, empresa_active: true, is_super_admin: false };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    empresa_id: tenant,
    created_by: owner,
    status: "completed",
    context_type: "invoice",
    context_id: null,
    target_field: null,
    file_name: "factura.pdf",
    file_size_bytes: 12,
    page_count: 1,
    storage_path: `${tenant}/scans/${sessionId}/factura.pdf`,
    storage_bucket: "invoice-files",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    completed_at: new Date().toISOString(),
    ...overrides,
  };
}

async function statusRequest() {
  const response = await GET(new NextRequest(`http://localhost/api/scanner/status/${sessionId}`), {
    params: Promise.resolve({ id: sessionId }),
  });
  return { response, body: await response.json() };
}

describe("scanner session HTTP authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filters = {};
    mocks.profile = profile("admin");
    mocks.session = session();
    mocks.signedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.invalid/file" } });
    mocks.createSession.mockResolvedValue({
      session: { id: sessionId, pin_code: "123456", expires_at: "later", status: "waiting" },
      token: "one-time-token",
      joinUrl: "/scanner?t=one-time-token",
    });
  });

  it("signs an invoice object only for its creating admin in the fixed tenant path", async () => {
    const { response } = await statusRequest();
    expect(response.status).toBe(200);
    expect(mocks.filters).toMatchObject({ id: sessionId, empresa_id: tenant, created_by: owner });
    expect(mocks.signedUrl).toHaveBeenCalledWith(`${tenant}/scans/${sessionId}/factura.pdf`, 300);
  });

  it("preserves the commercial user's own general scanner session", async () => {
    mocks.profile = profile("comercial");
    mocks.session = session({ context_type: "general", storage_path: `${tenant}/scans/${sessionId}/foto.pdf`, file_name: "foto.pdf" });
    const { response } = await statusRequest();
    expect(response.status).toBe(200);
    expect(mocks.signedUrl).toHaveBeenCalledTimes(1);
  });

  it("blocks commercial invoice sessions even when they are the owner", async () => {
    mocks.profile = profile("comercial");
    const { response } = await statusRequest();
    expect(response.status).toBe(404);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it("hides other tenants' and same-tenant users' sessions from the status signer", async () => {
    mocks.profile = profile("admin", owner, "00000000-0000-4000-8000-000000000002");
    let result = await statusRequest();
    expect(result.response.status).toBe(404);
    expect(mocks.signedUrl).not.toHaveBeenCalled();

    mocks.filters = {};
    mocks.profile = profile("admin");
    mocks.session = session({ created_by: "00000000-0000-4000-8000-000000000012" });
    result = await statusRequest();
    expect(result.response.status).toBe(404);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it.each([
    { storage_path: `${tenant}/scans/00000000-0000-4000-8000-000000000099/factura.pdf` },
    { storage_path: `00000000-0000-4000-8000-000000000002/scans/${sessionId}/factura.pdf` },
    { storage_bucket: "public-invoices" },
  ])("refuses to sign a manipulated object reference", async (override) => {
    mocks.session = session(override);
    const { response } = await statusRequest();
    expect(response.status).toBe(409);
    expect(mocks.signedUrl).not.toHaveBeenCalled();
  });

  it("lets commercial users create general sessions but rejects invoice context", async () => {
    mocks.profile = profile("comercial");
    let request = new NextRequest("http://localhost/api/scanner/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contextType: "general" }),
    });
    let response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith(tenant, owner, expect.objectContaining({ contextType: "general" }));

    request = new NextRequest("http://localhost/api/scanner/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contextType: "invoice" }),
    });
    response = await POST(request);
    expect(response.status).toBe(403);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });

  it("allows invoice context for admins and rejects unknown contexts", async () => {
    mocks.profile = profile("admin");
    let request = new NextRequest("http://localhost/api/scanner/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contextType: "invoice" }),
    });
    let response = await POST(request);
    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith(tenant, owner, expect.objectContaining({ contextType: "invoice" }));

    request = new NextRequest("http://localhost/api/scanner/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contextType: "arbitrary" }),
    });
    response = await POST(request);
    expect(response.status).toBe(400);
    expect(mocks.createSession).toHaveBeenCalledTimes(1);
  });
});
