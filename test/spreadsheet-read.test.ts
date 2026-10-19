import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readSpreadsheet } from "@/lib/spreadsheet-read";

const csv = "Código,Descripción,Cantidad\nT1,Hormigón armado,2.5\n";
const toBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const header = (wb: XLSX.WorkBook) => (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })[0] as string[]);

describe("readSpreadsheet", () => {
  it("CSV preserves grouped amounts and leading zero codes for an explicit locale choice",()=>{
    const text='Código,Descripción,Cantidad,Precio\n001,Material,350.000,"1.234,56"\n';
    const wb=readSpreadsheet(XLSX,toBuffer(new TextEncoder().encode(text)),"presupuesto.csv");
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{header:1});
    expect(rows[1]).toEqual(["001","Material","350.000","1.234,56"]);
  });
  it("CSV UTF-8 sin BOM conserva tildes en los encabezados (antes quedaban como mojibake)", () => {
    const wb = readSpreadsheet(XLSX, toBuffer(new TextEncoder().encode(csv)), "presupuesto.csv");
    expect(header(wb)).toEqual(["Código", "Descripción", "Cantidad"]);
  });
  it("CSV UTF-8 con BOM también", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]);
    expect(header(readSpreadsheet(XLSX, toBuffer(withBom), "presupuesto.csv"))).toEqual(["Código", "Descripción", "Cantidad"]);
  });
  it("CSV en Windows-1252 (no es UTF-8 válido) mantiene la lectura previa", () => {
    const latin1 = new Uint8Array([...csv].map(ch => ch.charCodeAt(0)));
    expect(header(readSpreadsheet(XLSX, toBuffer(latin1), "presupuesto.csv"))).toEqual(["Código", "Descripción", "Cantidad"]);
  });
  it("XLSX no se ve afectado", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Código", "Descripción"], ["T1", "Muro"]]), "P");
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(header(readSpreadsheet(XLSX, out, "presupuesto.xlsx"))).toEqual(["Código", "Descripción"]);
  });
});
