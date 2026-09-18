export interface PdfPageInput {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * Convierte un DataURL (ej: data:image/jpeg;base64,...) a Uint8Array.
 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const parts = dataUrl.split(',');
  const base64 = parts[1] || parts[0];
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Ensambla un documento PDF válido (especificación PDF-1.4) con múltiples páginas
 * conteniendo imágenes JPEG con compresión nativa DCTDecode.
 */
export function buildPdfFromJpegPages(pages: PdfPageInput[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error('Se requiere al menos una página para generar el PDF');
  }

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let currentOffset = 0;

  function writeString(str: string) {
    const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
    let buf: Uint8Array;
    if (encoder) {
      buf = encoder.encode(str);
    } else {
      buf = new Uint8Array(Buffer.from(str, 'binary'));
    }
    chunks.push(buf);
    currentOffset += buf.length;
  }

  function writeBytes(bytes: Uint8Array) {
    chunks.push(bytes);
    currentOffset += bytes.length;
  }

  // Encabezado PDF 1.4
  writeString('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // Estructura de objetos:
  // Obj 1: Catalog
  // Obj 2: Pages tree
  // Por cada página i (0-indexed):
  //   Obj (3 + i*3): Page dictionary
  //   Obj (4 + i*3): Image XObject
  //   Obj (5 + i*3): Page content stream (dibuja la imagen)

  const numPages = pages.length;
  const pageObjIds: number[] = [];

  for (let i = 0; i < numPages; i++) {
    pageObjIds.push(3 + i * 3);
  }

  // 1 0 obj - Catalog
  offsets.push(currentOffset);
  writeString('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // 2 0 obj - Pages Tree
  offsets.push(currentOffset);
  const kidsStr = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  writeString(
    `2 0 obj\n<< /Type /Pages /Kids [ ${kidsStr} ] /Count ${numPages} >>\nendobj\n`
  );

  for (let i = 0; i < numPages; i++) {
    const page = pages[i];
    const pageId = 3 + i * 3;
    const imgId = 4 + i * 3;
    const contentId = 5 + i * 3;

    // Dimensiones en puntos PDF (72 puntos/pulgada). Asumimos estándar A4 proporcional
    const maxDimension = 842; // A4 height approx
    const scale = Math.min(595 / page.width, maxDimension / page.height, 1);
    const pdfW = Math.round(page.width * scale);
    const pdfH = Math.round(page.height * scale);

    // Page Object
    offsets.push(currentOffset);
    writeString(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pdfW} ${pdfH} ] ` +
        `/Contents ${contentId} 0 R ` +
        `/Resources << /XObject << /Im${i + 1} ${imgId} 0 R >> >> >>\nendobj\n`
    );

    // Image Object (DCTDecode para JPEG)
    offsets.push(currentOffset);
    const imgStreamLen = page.jpegBytes.length;
    writeString(
      `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgStreamLen} >>\nstream\n`
    );
    writeBytes(page.jpegBytes);
    writeString('\nendstream\nendobj\n');

    // Content Stream Object
    offsets.push(currentOffset);
    const drawStream = `q\n${pdfW} 0 0 ${pdfH} 0 0 cm\n/Im${i + 1} Do\nQ\n`;
    const contentStreamLen = drawStream.length;
    writeString(
      `${contentId} 0 obj\n<< /Length ${contentStreamLen} >>\nstream\n${drawStream}endstream\nendobj\n`
    );
  }

  // Cross-reference table (xref)
  const xrefOffset = currentOffset;
  const totalObjs = 2 + numPages * 3;

  writeString(`xref\n0 ${totalObjs + 1}\n`);
  writeString('0000000000 65535 f \n');

  for (let i = 0; i < totalObjs; i++) {
    const off = offsets[i].toString().padStart(10, '0');
    writeString(`${off} 00000 n \n`);
  }

  // Trailer
  writeString(
    `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  // Unir todos los fragmentos en un solo Uint8Array
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;

  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }

  return result;
}
