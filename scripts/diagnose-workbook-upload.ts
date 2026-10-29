import fs from "node:fs";
import { parseWorkbook } from "../lib/workbook-interpretation/parser";
import { toStoredSheets } from "../lib/certificates/workbook-store";
import { applyWorkbookFormatting, extractWorkbookFormatting } from "../lib/certificates/workbook-formatting";
import { decodeSnapshot, encodeSnapshot } from "../lib/certificates/snapshot-storage";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass the path to an .xlsx file.");
  const bytes = fs.readFileSync(file);
  const started = Date.now();
  const workbook = parseWorkbook(bytes, file.split(/[\\/]/).at(-1)!);
  const snapshot = { fileName: workbook.fileName, sheets: toStoredSheets(workbook), definedNames: workbook.definedNames ?? [] };
  const formatting = await extractWorkbookFormatting(bytes);
  const formatted = applyWorkbookFormatting(snapshot, formatting);
  const encoded = encodeSnapshot(formatted);
  console.log(JSON.stringify({
    elapsedMs: Date.now() - started,
    originalBytes: bytes.length,
    snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
    formattedBytes: Buffer.byteLength(JSON.stringify(formatted)),
    storedBytes: Buffer.byteLength(JSON.stringify(encoded)),
    lossless: JSON.stringify(decodeSnapshot(encoded)) === JSON.stringify(formatted),
    sheets: workbook.sheets.length,
    cells: snapshot.sheets.reduce((count, sheet) => count + sheet.cells.length, 0),
    styles: Object.keys(formatting.styles).length,
    styleCells: Object.values(formatting.sheets).reduce((count, sheet) => count + sheet.styleCells.length, 0),
  }, null, 2));
}

void main();
