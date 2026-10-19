import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { extractInvoiceFieldsFromPdf } from "../invoice-extraction";

const pdf = vi.hoisted(() => ({ info: vi.fn(), text: vi.fn(), screenshot: vi.fn(), destroy: vi.fn() }));
vi.mock("pdf-parse", () => ({ PDFParse: class {
  getInfo = pdf.info; getText = pdf.text; getScreenshot = pdf.screenshot; destroy = pdf.destroy;
} }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  pdf.info.mockResolvedValue({ total: 1, pages: [{ pageNumber: 1, width: 595, height: 842 }] });
  pdf.text.mockResolvedValue({ text: "", pages: [{ num: 1, text: "" }] });
  pdf.screenshot.mockResolvedValue({ pages: [{ pageNumber: 1, dataUrl: "data:image/png;base64,c2Nhbg==" }] });
  pdf.destroy.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ total: "110.000", subtotal: "100.000", vat: "10.000", items: [] }) } }] }) }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("reads an image-only PDF with vision instead of rejecting it", async () => {
  const result = await extractInvoiceFieldsFromPdf(Buffer.from("scan"));
  expect(result.error).toBeNull();
  expect(result.data?.total).toBe(110000);
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body.model).toBe("gpt-4o");
  expect(body.messages[1].content).toContainEqual({ type: "image_url", image_url: { url: "data:image/png;base64,c2Nhbg==" } });
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
it("includes every page of a mixed text/scan document, bounded before rendering", async () => {
  pdf.info.mockResolvedValue({ total: 2, pages: [{ pageNumber: 1, width: 595, height: 842 }, { pageNumber: 2, width: 10, height: 10000 }] });
  pdf.text.mockResolvedValue({ text: "FACTURA con texto en primera pagina", pages: [{ num: 1, text: "FACTURA con texto en primera pagina" }, { num: 2, text: "" }] });
  await extractInvoiceFieldsFromPdf(Buffer.from("mixed"), "receipt");
  expect(pdf.screenshot).toHaveBeenCalledTimes(2);
  expect(pdf.screenshot.mock.calls[1][0]).toMatchObject({ partial: [2], desiredWidth: 2.4 });
  const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
  expect(body.messages[1].content.filter((c: { type: string }) => c.type === "image_url")).toHaveLength(2);
  expect(body.messages[0].content).toContain("remito");
});
it("rejects over-limit documents without partial extraction or model calls", async () => {
  pdf.info.mockResolvedValue({ total: 11, pages: [] });
  const result = await extractInvoiceFieldsFromPdf(Buffer.from("large"));
  expect(result.data).toBeNull(); expect(result.error).toMatch(/10 páginas/);
  expect(fetch).not.toHaveBeenCalled(); expect(pdf.screenshot).not.toHaveBeenCalled();
  expect(pdf.destroy).toHaveBeenCalledOnce();
});
it("releases the parser on rendering failure and returns no guessed invoice", async () => {
  pdf.screenshot.mockRejectedValue(new Error("renderer failed"));
  const result = await extractInvoiceFieldsFromPdf(Buffer.from("bad"));
  expect(result.data).toBeNull(); expect(result.error).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled(); expect(pdf.destroy).toHaveBeenCalledOnce();
});
it("does not send a partially rendered multipage invoice to the model", async () => {
  pdf.info.mockResolvedValue({ total: 2, pages: [{ pageNumber: 1, width: 595, height: 842 }, { pageNumber: 2, width: 595, height: 842 }] });
  pdf.screenshot.mockResolvedValueOnce({ pages: [{ dataUrl: "data:image/png;base64,c2Nhbg==" }] }).mockResolvedValueOnce({ pages: [] });
  const result = await extractInvoiceFieldsFromPdf(Buffer.from("partial"));
  expect(result.data).toBeNull(); expect(result.error).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled(); expect(pdf.destroy).toHaveBeenCalledOnce();
});
it("rejects invalid page geometry before allocating a canvas", async () => {
  pdf.info.mockResolvedValue({ total: 1, pages: [{ pageNumber: 1, width: Infinity, height: 842 }] });
  const result = await extractInvoiceFieldsFromPdf(Buffer.from("geometry"));
  expect(result.data).toBeNull(); expect(pdf.screenshot).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects oversized PDF input before parsing", async () => {
  const result = await extractInvoiceFieldsFromPdf(Buffer.alloc(20 * 1024 * 1024 + 1));
  expect(result.error).toMatch(/20 MB/); expect(pdf.info).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
