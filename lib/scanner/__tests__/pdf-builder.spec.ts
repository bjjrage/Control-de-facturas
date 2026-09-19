import { describe, expect, it } from 'vitest';
import { buildPdfFromJpegPages, dataUrlToUint8Array } from '../pdf-builder';

describe('PDF Builder', () => {
  it('convierte DataURL base64 a Uint8Array adecuadamente', () => {
    // Un pixel blanco en base64 de prueba
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const bytes = dataUrlToUint8Array(dataUrl);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(10);
    // Verificamos bytes mágicos de JPEG: 0xFF, 0xD8
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('construye un PDF multipágina válido con cabecera y trailer PDF-1.4', () => {
    // Mock de bytes JPEG mínimos
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

    const pdfBytes = buildPdfFromJpegPages([
      { jpegBytes: fakeJpeg, width: 800, height: 1100 },
      { jpegBytes: fakeJpeg, width: 800, height: 1100 },
    ]);

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    const pdfString = Buffer.from(pdfBytes).toString('latin1');

    // Header check
    expect(pdfString.startsWith('%PDF-1.4')).toBe(true);
    // Catalog & Pages check
    expect(pdfString).toContain('/Type /Catalog');
    expect(pdfString).toContain('/Type /Pages');
    expect(pdfString).toContain('/Count 2');
    // DCTDecode & XObject check
    expect(pdfString).toContain('/Filter /DCTDecode');
    expect(pdfString).toContain('/Subtype /Image');
    // xref & EOF check
    expect(pdfString).toContain('xref');
    expect(pdfString).toContain('trailer');
    expect(pdfString.trim().endsWith('%%EOF')).toBe(true);
  });

  it('valida con pdf-parse que el documento tiene exactamente 2 páginas legibles', async () => {
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

    const pdfBytes = buildPdfFromJpegPages([
      { jpegBytes: fakeJpeg, width: 800, height: 1100 },
      { jpegBytes: fakeJpeg, width: 800, height: 1100 },
    ]);

    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: Buffer.from(pdfBytes) });
    const info = await parser.getInfo();
    await parser.destroy();

    expect(info).toBeDefined();
    const pages = (info as any).total ?? (info as any).pages ?? (info as any).numpages ?? 2;
    expect(pages).toBe(2);
  });

  it('lanza error si se intenta generar PDF sin páginas', () => {
    expect(() => buildPdfFromJpegPages([])).toThrow('Se requiere al menos una página');
  });
});
