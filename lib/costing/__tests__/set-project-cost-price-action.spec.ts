import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createClient: vi.fn(),
    createAdminClient: vi.fn(),
    requirePlan: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/auth", () => ({ requirePlan: mocks.requirePlan }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { setProjectCostPriceAction } from "@/app/(internal)/projects/[id]/costeo-actions";

type QueryResult = { data: any; error: any };

function makeMockDb() {
  const responses = new Map<string, QueryResult[]>();
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const upserts: Array<{ values: any; options: unknown[] }> = [];

  const db = {
    from(table: string) {
      const result = Promise.resolve(responses.get(table)?.shift() ?? { data: null, error: null });
      let chain: Record<string, any>;
      chain = new Proxy({}, {
        get(_target, property: string) {
          if (property === "then") return result.then.bind(result);
          if (property === "maybeSingle") return () => result;
          if (property === "upsert") {
            return (values: any, ...options: unknown[]) => {
              upserts.push({ values, options });
              return chain;
            };
          }
          return (...args: unknown[]) => {
            calls.push({ table, method: property, args });
            return chain;
          };
        },
      });
      return chain;
    },
    respond(table: string, ...rows: QueryResult[]) {
      responses.set(table, rows);
    },
    calls,
    upserts,
  };
  return db;
}

const PROFILE = { id: "profile-1", empresa_id: "empresa-1" };
const INPUT = {
  projectId: "project-1",
  productoId: "product-1",
  precio: 3,
  fuente: "COTIZACION" as const,
  quoteVersionItemId: "quote-version-item-1",
};

let userDb: ReturnType<typeof makeMockDb>;
let adminDb: ReturnType<typeof makeMockDb>;

function response(data: any, error: any = null): QueryResult {
  return { data, error };
}

function seedProject() {
  userDb.respond("projects", response({ id: "project-1" }));
}

function seedValidQuote(currentVersionId = "quote-version-1") {
  adminDb.respond("quote_version_items", response({
    id: "quote-version-item-1",
    quote_version_id: "quote-version-1",
    rfq_item_id: "rfq-item-1",
    precio_unitario: "125.5000",
  }));
  adminDb.respond("rfq_items", response({ id: "rfq-item-1", rfq_id: "rfq-1", producto_id: "product-1" }));
  adminDb.respond("rfqs", response({ id: "rfq-1", project_id: "project-1" }));
  adminDb.respond("quote_versions",
    response({
      id: "quote-version-1",
      quote_id: "quote-1",
      version_number: 2,
      currency: "PYG",
      offer_validity: "30 dias",
      submitted_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    }),
    response({ id: currentVersionId })
  );
  adminDb.respond("quotes", response({ id: "quote-1", rfq_provider_id: "rfq-provider-1" }));
  adminDb.respond("rfq_providers", response({ id: "rfq-provider-1", rfq_id: "rfq-1" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  userDb = makeMockDb();
  adminDb = makeMockDb();
  seedProject();
  mocks.createClient.mockResolvedValue(userDb);
  mocks.createAdminClient.mockReturnValue(adminDb);
  mocks.requirePlan.mockResolvedValue(PROFILE);
});

describe("setProjectCostPriceAction — provenance de cotizaciones", () => {
  it("adopta la cotización válida con el precio real de DB y scope server-side", async () => {
    seedValidQuote();

    const result = await setProjectCostPriceAction(INPUT);

    expect(result.error).toBeNull();
    expect(userDb.upserts).toHaveLength(1);
    expect(userDb.upserts[0].values).toMatchObject({
      empresa_id: PROFILE.empresa_id,
      project_id: INPUT.projectId,
      producto_id: INPUT.productoId,
      precio_unitario: 125.5,
      fuente: "COTIZACION",
      quote_version_item_id: INPUT.quoteVersionItemId,
      updated_by: PROFILE.id,
    });
    expect(Number.isNaN(Date.parse(userDb.upserts[0].values.updated_at))).toBe(false);
    expect(adminDb.calls).toContainEqual({ table: "quote_version_items", method: "eq", args: ["empresa_id", PROFILE.empresa_id] });
    expect(adminDb.calls).toContainEqual({ table: "rfq_items", method: "eq", args: ["empresa_id", PROFILE.empresa_id] });
    expect(adminDb.calls).toContainEqual({ table: "rfq_items", method: "eq", args: ["producto_id", INPUT.productoId] });
    expect(adminDb.calls).toContainEqual({ table: "rfqs", method: "eq", args: ["empresa_id", PROFILE.empresa_id] });
    expect(adminDb.calls).toContainEqual({ table: "rfqs", method: "eq", args: ["project_id", INPUT.projectId] });
    expect(adminDb.calls).toContainEqual({ table: "quote_versions", method: "order", args: ["version_number", { ascending: false }] });
  });

  it("ignora un precio de cotización manipulado por el cliente", async () => {
    seedValidQuote();

    const result = await setProjectCostPriceAction({ ...INPUT, precio: 999999999 });

    expect(result.error).toBeNull();
    expect(userDb.upserts[0].values.precio_unitario).toBe(125.5);
  });

  it("rechaza una cotización cuyo ítem corresponde a otro producto", async () => {
    adminDb.respond("quote_version_items", response({
      id: INPUT.quoteVersionItemId,
      quote_version_id: "quote-version-1",
      rfq_item_id: "rfq-item-1",
      precio_unitario: 125.5,
    }));
    adminDb.respond("rfq_items", response(null));

    const result = await setProjectCostPriceAction(INPUT);

    expect(result.error).toBeTruthy();
    expect(userDb.upserts).toHaveLength(0);
    expect(adminDb.calls).toContainEqual({ table: "rfq_items", method: "eq", args: ["producto_id", INPUT.productoId] });
  });

  it("rechaza una RFQ de otra obra", async () => {
    adminDb.respond("quote_version_items", response({
      id: INPUT.quoteVersionItemId,
      quote_version_id: "quote-version-1",
      rfq_item_id: "rfq-item-1",
      precio_unitario: 125.5,
    }));
    adminDb.respond("rfq_items", response({ id: "rfq-item-1", rfq_id: "rfq-other", producto_id: INPUT.productoId }));
    adminDb.respond("rfqs", response(null));

    const result = await setProjectCostPriceAction(INPUT);

    expect(result.error).toBeTruthy();
    expect(userDb.upserts).toHaveLength(0);
    expect(adminDb.calls).toContainEqual({ table: "rfqs", method: "eq", args: ["project_id", INPUT.projectId] });
  });

  it("rechaza una línea conectada a un proveedor de otra RFQ", async () => {
    seedValidQuote();
    adminDb.respond("rfq_providers", response({ id: "rfq-provider-1", rfq_id: "rfq-other" }));

    const result = await setProjectCostPriceAction(INPUT);

    expect(result.error).toBeTruthy();
    expect(userDb.upserts).toHaveLength(0);
  });

  it("rechaza un quote_version_item inexistente", async () => {
    adminDb.respond("quote_version_items", response(null));

    const result = await setProjectCostPriceAction(INPUT);

    expect(result.error).toBeTruthy();
    expect(userDb.upserts).toHaveLength(0);
  });

  it("rechaza COTIZACION sin quoteVersionItemId", async () => {
    const result = await setProjectCostPriceAction({
      projectId: INPUT.projectId,
      productoId: INPUT.productoId,
      precio: INPUT.precio,
      fuente: "COTIZACION",
    });

    expect(result.error).toBeTruthy();
    expect(adminDb.calls).toHaveLength(0);
    expect(userDb.upserts).toHaveLength(0);
  });

  it("rechaza una versión anterior de la cotización", async () => {
    seedValidQuote("quote-version-2");

    const result = await setProjectCostPriceAction(INPUT);

    expect(result.error).toBeTruthy();
    expect(userDb.upserts).toHaveLength(0);
  });

  it("guarda MANUAL válido con quote_version_item_id nulo aunque el cliente envíe provenance", async () => {
    const result = await setProjectCostPriceAction({
      projectId: INPUT.projectId,
      productoId: INPUT.productoId,
      precio: 77,
      fuente: "MANUAL",
      quoteVersionItemId: "untrusted-quote-item",
    });

    expect(result.error).toBeNull();
    expect(userDb.upserts[0].values).toMatchObject({
      precio_unitario: 77,
      fuente: "MANUAL",
      quote_version_item_id: null,
      updated_by: PROFILE.id,
    });
    expect(adminDb.calls).toHaveLength(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])("rechaza MANUAL con precio %s", async (precio) => {
    const result = await setProjectCostPriceAction({
      projectId: INPUT.projectId,
      productoId: INPUT.productoId,
      precio,
      fuente: "MANUAL",
    });

    expect(result.error).toBeTruthy();
    expect(userDb.upserts).toHaveLength(0);
  });
});
