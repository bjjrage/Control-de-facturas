import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mockeamos pdf-parse (mismo patrón de import perezoso que usa
// lib/invoice-extraction.ts) para no depender de un PDF real ni de su
// dependencia nativa en el entorno de test.
const mockGetText = vi.fn();
const mockDestroy = vi.fn();
class MockPDFParse {
  getText = mockGetText;
  destroy = mockDestroy;
}
vi.mock("pdf-parse", () => ({ PDFParse: MockPDFParse }));

import { extractComputoFromPdf } from "../pdf-extractor";

function mockDeepSeekResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(body) } }] }),
    text: async () => "",
  } as Response;
}

describe("extractComputoFromPdf — gate de confianza de 3 capas", () => {
  const originalEnv = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
    mockGetText.mockReset();
    mockDestroy.mockReset();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env.DEEPSEEK_API_KEY = originalEnv;
    vi.unstubAllGlobals();
  });

  it("capa 1 — PDF sin texto (escaneo) se marca vicious sin llamar a DeepSeek", async () => {
    mockGetText.mockResolvedValue({ text: "   " });
    const result = await extractComputoFromPdf(Buffer.from("fake"));
    expect(result.vicious).toBe(true);
    expect(result.confidenceSummary.textLayerOk).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("capa 1 — PDF que falla al abrirse se marca vicious", async () => {
    mockGetText.mockRejectedValue(new Error("corrupto"));
    const result = await extractComputoFromPdf(Buffer.from("fake"));
    expect(result.vicious).toBe(true);
    expect(result.confidenceSummary.textLayerOk).toBe(false);
  });

  it("capa 2 — DeepSeek dice tabla_clara=false -> vicious, aunque las filas parezcan limpias", async () => {
    mockGetText.mockResolvedValue({ text: "texto largo ".repeat(10) });
    vi.mocked(fetch).mockResolvedValue(
      mockDeepSeekResponse({
        tabla_clara: false,
        filas: [{ descripcion: "Mampostería cerámica 15 cm", cantidad: 40, unidad: "m2", confianza: 0.9 }],
      })
    );
    const result = await extractComputoFromPdf(Buffer.from("fake"));
    expect(result.vicious).toBe(true);
  });

  it("capa 3 — muchas filas con problemas de sanidad -> vicious aunque la IA diga tabla_clara=true", async () => {
    mockGetText.mockResolvedValue({ text: "texto largo ".repeat(10) });
    vi.mocked(fetch).mockResolvedValue(
      mockDeepSeekResponse({
        tabla_clara: true,
        filas: [
          { descripcion: "Item 1", cantidad: -5, unidad: "xyz", confianza: 0.8 }, // cantidad inválida + unidad no reconocida
          { descripcion: "", cantidad: 10, unidad: "m2", confianza: 0.8 }, // descripción vacía
          { descripcion: "Item 3", cantidad: 10, unidad: "m2", confianza: 0.9 }, // limpia
        ],
      })
    );
    const result = await extractComputoFromPdf(Buffer.from("fake"));
    expect(result.vicious).toBe(true);
    expect(result.confidenceSummary.sanityIssues.length).toBeGreaterThan(0);
  });

  it("caso limpio — texto real, tabla clara, filas sanas -> NO vicious", async () => {
    mockGetText.mockResolvedValue({ text: "texto largo ".repeat(10) });
    vi.mocked(fetch).mockResolvedValue(
      mockDeepSeekResponse({
        tabla_clara: true,
        filas: [
          { descripcion: "Mampostería cerámica 15 cm", cantidad: 40, unidad: "m2", confianza: 0.95 },
          { descripcion: "Hormigón estructural H30", cantidad: 12, unidad: "m3", confianza: 0.9 },
        ],
      })
    );
    const result = await extractComputoFromPdf(Buffer.from("fake"));
    expect(result.vicious).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.confidenceSummary.textLayerOk).toBe(true);
    expect(result.confidenceSummary.llmConfidence).toBeGreaterThan(0.5);
  });

  it("confianza promedio baja -> vicious aunque tabla_clara=true y sin problemas de sanidad", async () => {
    mockGetText.mockResolvedValue({ text: "texto largo ".repeat(10) });
    vi.mocked(fetch).mockResolvedValue(
      mockDeepSeekResponse({
        tabla_clara: true,
        filas: [
          { descripcion: "Item dudoso 1", cantidad: 5, unidad: "m2", confianza: 0.2 },
          { descripcion: "Item dudoso 2", cantidad: 8, unidad: "m2", confianza: 0.3 },
        ],
      })
    );
    const result = await extractComputoFromPdf(Buffer.from("fake"));
    expect(result.vicious).toBe(true);
  });

  it("sin DEEPSEEK_API_KEY -> tira, nunca hay fallback silencioso", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    mockGetText.mockResolvedValue({ text: "texto largo ".repeat(10) });
    await expect(extractComputoFromPdf(Buffer.from("fake"))).rejects.toThrow(/DEEPSEEK_API_KEY/);
  });
});
