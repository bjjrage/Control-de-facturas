import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createClientMock,
  requirePlanMock,
  logAuditMock,
  revalidatePathMock,
  loadCertificateWorkbookMock,
  buildCanonicalImportCandidateMock,
  fromMock,
  deleteMock,
  insertMock,
  updateMock,
} = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requirePlanMock: vi.fn(),
  logAuditMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  loadCertificateWorkbookMock: vi.fn(),
  buildCanonicalImportCandidateMock: vi.fn(),
  fromMock: vi.fn(),
  deleteMock: vi.fn(),
  insertMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/auth", () => ({ requirePlan: requirePlanMock }));
vi.mock("@/lib/audit", () => ({ logAudit: logAuditMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/workbook-interpretation/canonical-import", () => ({
  buildCanonicalImportCandidate: buildCanonicalImportCandidateMock,
}));
vi.mock("@/lib/certificates/workbook-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/certificates/workbook-store")>();
  return {
    ...actual,
    computeStructureHash: vi.fn(() => "structure-hash"),
    loadCertificateWorkbook: loadCertificateWorkbookMock,
    mappingStillValid: vi.fn(() => ({ valid: true })),
    workbookFromSnapshot: vi.fn(() => ({ sheets: [] })),
  };
});

import { applyCertificateWorkbook } from "@/app/(internal)/projects/certificado-workbook-actions";

type ItemOverrides = {
  description?: string | null;
  quantityContractual?: number | null;
  quantityPrevious?: number | null;
  quantityCurrent?: number | null;
  unitPrice?: number | null;
};

function validItem(overrides: ItemOverrides = {}) {
  return {
    code: "01",
    description: "Excavación manual",
    unit: "m3",
    quantityContractual: 10,
    quantityPrevious: 2,
    quantityCurrent: 3,
    quantityCumulative: 5,
    unitPrice: 1500,
    amountPrevious: 3000,
    amountCurrent: 4500,
    amountCumulative: 7500,
    percentage: 50,
    matchedBudgetCode: null,
    matchedBudgetRow: null,
    matchQuality: "NO_BUDGET",
    matchNote: null,
    source: { sheet: "Certificado", row: 7, range: "A7:F7" },
    ...overrides,
  };
}

const invalidCases: Array<{
  name: string;
  overrides: ItemOverrides;
  expectedMessage: string;
}> = [
  { name: "cantidad contractual nula", overrides: { quantityContractual: null }, expectedMessage: "cantidad contractual es obligatoria" },
  { name: "cantidad contractual negativa", overrides: { quantityContractual: -1 }, expectedMessage: "cantidad contractual no puede ser negativa" },
  { name: "cantidad anterior nula", overrides: { quantityPrevious: null }, expectedMessage: "cantidad anterior es obligatoria" },
  { name: "cantidad anterior negativa", overrides: { quantityPrevious: -1 }, expectedMessage: "cantidad anterior no puede ser negativa" },
  { name: "cantidad presente nula", overrides: { quantityCurrent: null }, expectedMessage: "cantidad presente es obligatoria" },
  { name: "cantidad presente negativa", overrides: { quantityCurrent: -1 }, expectedMessage: "cantidad presente no puede ser negativa" },
  { name: "precio unitario nulo", overrides: { unitPrice: null }, expectedMessage: "precio unitario es obligatoria" },
  { name: "precio unitario negativo", overrides: { unitPrice: -1 }, expectedMessage: "precio unitario no puede ser negativa" },
  { name: "descripción vacía", overrides: { description: "   " }, expectedMessage: "la descripción está vacía" },
];

type MockQuery = {
  select: (...args: unknown[]) => MockQuery;
  eq: (...args: unknown[]) => MockQuery;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  delete: () => MockQuery;
  insert: (rows: unknown) => MockQuery;
  update: (patch: unknown) => MockQuery;
  then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>;
};

describe("applyCertificateWorkbook — guard temporal pre-DELETE", () => {
  let candidateItems: ReturnType<typeof validItem>[];

  beforeEach(() => {
    vi.clearAllMocks();
    candidateItems = [];

    const certificate = {
      id: "certificate-1",
      project_id: "project-1",
      numero: 6,
      status: "BORRADOR",
      projects: { empresa_id: "empresa-1" },
    };

    fromMock.mockImplementation((table: string) => {
      const query: MockQuery = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: certificate, error: null }),
        delete: () => {
          deleteMock();
          return query;
        },
        insert: (rows) => {
          insertMock(rows);
          return query;
        },
        update: (patch) => {
          updateMock(patch);
          return query;
        },
        then: (resolve, reject) =>
          Promise.resolve({ data: table === "budget_items" ? [] : null, error: null }).then(resolve, reject),
      };
      return query;
    });

    createClientMock.mockResolvedValue({ from: fromMock });
    requirePlanMock.mockResolvedValue({ id: "user-1", empresa_id: "empresa-1" });
    loadCertificateWorkbookMock.mockResolvedValue({
      mapping: {},
      mappingStructureHash: "structure-hash",
      workingSnapshot: {},
    });
    buildCanonicalImportCandidateMock.mockImplementation(() => ({
      certificate: {
        status: "SAFE_TO_APPLY",
        number: null,
        reason: "",
        items: candidateItems,
      },
    }));
  });

  it.each(invalidCases)("$name detiene la aplicación sin borrar ni insertar", async ({ overrides, expectedMessage }) => {
    candidateItems = [validItem(), validItem(overrides)];

    const result = await applyCertificateWorkbook("certificate-1");

    expect(result.error).toContain("Fila 7 (código 01)");
    expect(result.error).toContain(expectedMessage);
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
