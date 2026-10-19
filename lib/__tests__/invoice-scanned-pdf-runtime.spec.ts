import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { extractInvoiceFieldsFromPdf } from "../invoice-extraction";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("renders the actual C06 image-only PDF using the installed native runtime", async () => {
  vi.stubEnv("OPENAI_API_KEY", "unit-test-key");
  const fetchMock = vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    const image = body.messages[1].content.find((c: { type: string }) => c.type === "image_url");
    expect(image.image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(image.image_url.url.split(",")[1], "base64").byteLength).toBeGreaterThan(10000);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ total: "110.000", items: [] }) } }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await extractInvoiceFieldsFromPdf(readFileSync("test/fixtures/invoices/c06-scan.pdf"));
  expect(result.error).toBeNull();
  expect(result.data?.total).toBe(110000);
  expect(fetchMock).toHaveBeenCalledOnce();
}, 60000);
