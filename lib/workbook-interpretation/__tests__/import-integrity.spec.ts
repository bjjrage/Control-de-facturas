import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "../parser";
import { buildCanonicalImportCandidate } from "../canonical-import";
import { inspectImportIntegrity, selectedImportIssues } from "../import-integrity";
import { toStoredSheets, workbookFromSnapshot, type WorkingSnapshot } from "@/lib/certificates/workbook-store";
import { workingSnapshotToUniver, univerToWorkingSnapshot } from "@/lib/certificates/univer-adapter";
import type { ImportBlock, WorkbookInterpretationResult } from "../types";

const field = (value: string | null) => ({ status: value ? "FOUND" as const : "NOT_FOUND" as const, value, confidence: 1 });
function fixture() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Fecha de inicio", "Período: desde 21/07/2026 hasta 20/08/2026"],
    ["Orden de Inicio de Ejecución de Obra", (Date.UTC(2026,1,9)-Date.UTC(1899,11,30))/86400000],
    ["Plazo Contractual:", "175 días"],
    ["Programado mes", 0.1756, 0.2793, 0.3168, 0.1662, 0.0621],
    ["Año", "Mes", 1, 2, 3, "Otros"],
    [2026, "Febrero", "LL", "HH", "O"],
  ]);
  for (const col of ["B","C","D","E","F"]) sheet[col+"4"].z = "0.00%";
  sheet.F6 = { t: "n", v: 2, f: 'COUNTIF(C6:E6,"O")+1' };
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "Obra");
  const workbook = parseWorkbook(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), "fixture.xlsx");
  const block: ImportBlock = { id:"curve", sheet:"Obra", sourceRange:"A1:F6", target:"SCHEDULE", confidence:1, needsReview:false, headerRowStart:1, headerRowEnd:3, dataRowStart:4, dataRowEnd:4, columnMappings:[], repeatedHeaderRows:[], subtotalRows:[], footerRows:[], excludedRows:[], notes:"",
    scheduleSeries:[{row:4,label:"Original",role:"PLANNED_MONTHLY",planVersion:"Original",monthColumns:["B","C","D","E","F"].map((column,i)=>({column,monthIndex:i+1}))}] };
  const result: WorkbookInterpretationResult = { documentType:"CONSTRUCTION_PROJECT",workbookSummary:{summary:"Prueba",sheetCount:1},project:{name:field("Obra"),code:field("TEST"),client:field(null),contractor:field(null),location:field(null),contractNumber:field(null),totalAmount:{...field(null)},startDate:{...field("2026-07-21"),source:{sheet:"Obra",range:"B1"}},endDate:{...field("2026-08-20"),source:{sheet:"Obra",range:"B1"}}},importPlan:{workbookType:"CONSTRUCTION_PROJECT",overallConfidence:1,blocks:[block],unresolvedRegions:[],warnings:[]},detectedSections:[],budgetItems:[],coverage:[],warnings:[],unknownSections:[],overallConfidence:1 };
  return { workbook,result };
}
describe("import integrity across Excel, stored grid, and operational modules", () => {
  it("preserves percentage units through an edited grid round trip", () => {
    const { workbook,result } = fixture();
    const snapshot: WorkingSnapshot = {fileName:"fixture.xlsx",sheets:toStoredSheets(workbook),definedNames:[],styles:{pct:{n:{pattern:"0.00%"}}}};
    snapshot.sheets[0].styleCells = ["B","C","D","E","F"].map(c=>[4,XLSX.utils.decode_col(c)+1,"pct"]);
    const edited = univerToWorkingSnapshot(workingSnapshotToUniver(snapshot,"roundtrip"),"fixture.xlsx");
    const candidate = buildCanonicalImportCandidate(workbookFromSnapshot(edited),result);
    candidate.schedulePlans[0].months.forEach((m,i)=>expect(m.programadoPct).toBeCloseTo([17.56,27.93,31.68,16.62,6.21][i],8));
    expect(candidate.integrity?.issues.filter(i=>i.domain==="SCHEDULE")).toEqual([]);
  });
  it("rejects the fraction/percentage regression instead of activating a 1% curve", () => {
    const {workbook,result}=fixture();
    for (const cell of workbook.sheets[0].cells.filter(c=>c.row===4)) { cell.numberFormat="General"; cell.formatted=String(cell.raw); }
    const candidate=buildCanonicalImportCandidate(workbook,result);
    expect(candidate.integrity?.issues.some(i=>i.domain==="SCHEDULE"&&i.severity==="ERROR")).toBe(true);
    expect(selectedImportIssues(candidate.integrity!,{schedule:false,weather:false}).some(i=>i.domain==="SCHEDULE")).toBe(false);
  });
  it("uses contractual evidence and never turns a certificate period into project dates", () => {
    const {workbook,result}=fixture();
    const report=inspectImportIntegrity(workbook,result,{schedulePlans:[],weatherDays:[]});
    expect(report.project.orderDate?.value).toBe("2026-02-09");
    expect(report.project.startDate?.value).toBe("2026-02-09");
    expect(report.project.durationDays?.value).toBe(175);
    expect(report.project.endDate).toBeNull();
    expect(report.issues.filter(i=>i.severity==="REVIEW")).toHaveLength(2);
  });
  it("reports the +1 discrepancy without manufacturing a dated workday", () => {
    const {workbook,result}=fixture();
    const weatherDays = [{date:"2026-02-10",code:"O" as const,sheet:"Obra",row:6,column:"E"}];
    const report=inspectImportIntegrity(workbook,result,{schedulePlans:[],weatherDays});
    expect(report.weatherCounts.O).toBe(1);
    expect(report.issues.find(i=>i.domain==="WEATHER")?.message).toContain("declara 2");
    expect(weatherDays).toHaveLength(1);
  });
  it("blocks duplicate days and dates outside the execution period", () => {
    const {workbook,result}=fixture();
    const day={date:"2026-02-01",code:"O" as const,sheet:"Obra",row:6,column:"E"};
    const report=inspectImportIntegrity(workbook,result,{schedulePlans:[],weatherDays:[day,day]});
    expect(report.issues.filter(i=>i.domain==="WEATHER"&&i.severity==="ERROR")).toHaveLength(3);
  });
});
