// Genera fotos PNG simples (color sólido + etiqueta en el nombre del archivo)
// para probar la carga de fotos en la tab Ejecución. No son fotos reales de
// obra — son placeholders de color plano, pero sirven para probar el flujo
// completo: selección múltiple, compresión client-side, subida a Storage,
// miniaturas y lightbox.
//
// Correr: node mock-data/construccion/generate-mock-photos.mjs
import * as fs from "fs";
import * as zlib from "zlib";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function solidColorPng(width, height, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowSize = 1 + width * 3;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
    }
  }
  const idatData = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idatData),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const photos = [
  { name: "avance-01-excavacion.png", color: [139, 115, 85] },   // marrón tierra
  { name: "avance-02-hormigon.png", color: [160, 160, 160] },    // gris hormigón
  { name: "avance-03-mamposteria.png", color: [178, 34, 34] },   // rojo ladrillo
  { name: "avance-04-techo.png", color: [70, 90, 110] },         // gris azulado chapa
];

for (const p of photos) {
  const buf = solidColorPng(800, 600, p.color);
  fs.writeFileSync(join(__dirname, p.name), buf);
  console.log("Generado:", p.name, `(${(buf.length / 1024).toFixed(1)} KB)`);
}
