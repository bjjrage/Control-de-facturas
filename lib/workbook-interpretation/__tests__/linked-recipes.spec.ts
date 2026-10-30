import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "../parser";
import { extractBudgetItems } from "../import-plan";
import { extractLinkedRecipes } from "../linked-recipes";
import type { ImportPlan } from "../types";

function fixture() {
  const book = XLSX.utils.book_new();
  const budget = XLSX.utils.aoa_to_sheet([["Código","Descripción","Unidad","Cantidad","Precio"],["1","Muro","m2",1,400]]);
  budget.E2 = { t: "n", v: 400, f: "Recetas!E21" };
  XLSX.utils.book_append_sheet(book,budget,"Partidas");
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
    ["FORMULARIO DE COMPOSICIÓN DE PRECIOS UNITARIOS"],["Fecha","Ítem N°: 1"],
    ["Obra",null,null,"Unidad : m2"],["Rubro: Muro"],["a. Equipo a utilizar"],
    ["Herramientas","s/d",0.2,15000,3000],["A. Total Gs."],["b. Mano de Obra"],
    ["Ayudante",2,1,200,400],["B. Total Gs."],["C. Producción de equipo p/h",10],
    ["D. Costo unitario",null,null,null,340],["E. Materiales"],["Cemento","kg",2,5,10],
    ["C) Total Gs."],["F. Transporte"],["Flete",2,1,3,6],["C) Total Gs."],
    ["Costo Directo Total",null,null,null,356],["Gastos Generales",null,null,null,44],
    ["COSTO UNITARIO ADOPTADO",null,null,null,400],
  ]),"Recetas");
  const workbook = parseWorkbook(new Uint8Array(XLSX.write(book,{type:"buffer",bookType:"xlsx"})),"test.xlsx");
  const block = { id:"budget",sheet:"Partidas",sourceRange:"A1:E2",target:"BUDGET" as const,mainProject:true,confidence:1,needsReview:false,headerRowStart:1,headerRowEnd:1,dataRowStart:2,dataRowEnd:2,
    columnMappings: ["code","description","unit","quantity","unitPrice"].map((role,i)=>({column:String.fromCharCode(65+i),role:role as "code",confidence:1,notes:""})),repeatedHeaderRows:[],subtotalRows:[],footerRows:[],excludedRows:[],notes:"" };
  const plan: ImportPlan = {workbookType:"CONSTRUCTION_PROJECT",overallConfidence:1,blocks:[block],unresolvedRegions:[],warnings:[]};
  return {workbook,plan};
}

describe("linked workbook recipes",()=>{
  it("uses each schedule section's own headers and rejects equipment IDs that merely equal item codes", () => {
    const { workbook, plan } = fixture();
    const cells = [
      [1,1,"Ítem"], [1,3,"Día inicio"], [1,4,"Día fin"], [1,6,"Mes 1"],
      [2,1,1], [2,3,1], [2,4,10], [2,6,99],
      [4,1,"Ítem"], [4,4,"Día inicio"], [4,5,"Día fin"], [4,6,"Mes 1"],
      [5,1,1], [5,4,31], [5,5,60], [5,6,400],
    ].map(([row,column,raw]) => ({ row: Number(row), column: Number(column), raw: raw as string | number, address: XLSX.utils.encode_cell({ r: Number(row)-1,c: Number(column)-1 }), type: typeof raw === "number" ? "n" : "s", formatted: null, formula: Number(row) === 5 && Number(column) === 1 ? "Partidas!A2" : null }));
    workbook.sheets.push({ ...workbook.sheets[0], sheetName: "Cronograma", cells });
    plan.blocks.push({ ...plan.blocks[0], id:"schedule", sheet:"Cronograma", target:"SCHEDULE", sourceRange:"A1:F5", headerRowStart:1, headerRowEnd:1, dataRowStart:2,dataRowEnd:5 });
    const linked = extractLinkedRecipes(workbook, plan, extractBudgetItems(workbook, plan).items);
    expect(linked.relativeSchedule).toEqual([{ budgetCode:"1", startDay:31,endDay:60,source:{sheet:"Cronograma",row:5},monthlyValues:[{month:1,value:400,cell:"F5"}] }]);
    expect(linked.issues).toEqual([]);
  });
  it("respects an explicit budget and never imports an OTHER comparison as duplicate partidas",()=>{
    const {workbook,plan}=fixture();
    plan.blocks.push({...plan.blocks[0],id:"comparison",target:"OTHER"});
    expect(extractBudgetItems(workbook,plan).items).toHaveLength(1);
  });
  it("links by formula, normalizes crew hours by production and preserves workbook formulas",()=>{
    const {workbook,plan}=fixture();const before=JSON.stringify(workbook);
    const result=extractLinkedRecipes(workbook,plan,extractBudgetItems(workbook,plan).items);
    expect(result.issues).toEqual([]);expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0].lines.map(l=>[l.kind,l.quantity,l.price])).toEqual([["EQUIPMENT",0.02,15000],["LABOR",0.2,200],["MATERIAL",2,5],["TRANSPORT",1,6]]);
    expect(result.recipes[0].adjustments[0].amount).toBe(44);
    expect(JSON.stringify(workbook)).toBe(before);
  });
  it("blocks unverified production instead of treating crew hours as per-unit consumption",()=>{
    const {workbook,plan}=fixture();workbook.sheets[1].cells.find(c=>c.address==="B11")!.raw=0;
    const result=extractLinkedRecipes(workbook,plan,extractBudgetItems(workbook,plan).items);
    expect(result.recipes).toHaveLength(0);expect(result.issues.join(" ")).toMatch(/rendimiento/);
  });
});
