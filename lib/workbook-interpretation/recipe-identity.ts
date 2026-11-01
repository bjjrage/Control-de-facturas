import * as XLSX from "xlsx";
import type { ImportPlan, WorkbookRepresentation } from "./types";

const norm = (v: unknown) => String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ").trim();
/** A catalog code can repeat across items. Corroborate item identity only
 * when every price points directly at a matching, explicitly numbered APU.
 * No fuzzy names, generated codes, or model-supplied numeric values. */
export function corroborateRecipeItemCodes(workbook: WorkbookRepresentation, input: ImportPlan) {
  const plan = structuredClone(input), corrections: string[] = [];
  for (const block of plan.blocks.filter(b=>b.mainProject!==false&&b.target==="BUDGET")) {
    const sheet=workbook.sheets.find(s=>s.sheetName===block.sheet);
    const codeMappings=block.columnMappings.filter(m=>m.role==="code"),prices=block.columnMappings.filter(m=>m.role==="unitPrice"),descriptions=block.columnMappings.filter(m=>m.role==="description");
    if(!sheet||codeMappings.length!==1||prices.length!==1||descriptions.length!==1)continue;
    const cells=new Map(sheet.cells.map(c=>[c.address,c]));
    const candidates=sheet.cells.filter(c=>c.row>=block.headerRowStart&&c.row<=block.headerRowEnd&&/^(?:item|n(?:ro|umero|°|º)\.?\s*(?:de\s*)?(?:item|partida)?)$/.test(norm(c.raw))).map(c=>XLSX.utils.encode_col(c.column-1));
    if(candidates.length!==1||candidates[0]===codeMappings[0].column)continue;
    const excluded=new Set([...block.repeatedHeaderRows,...block.subtotalRows,...block.footerRows,...block.excludedRows.map(r=>r.row)]);
    const codes: string[]=[];let valid=true;
    for(let row=block.dataRowStart;row<=block.dataRowEnd;row++){
      if(excluded.has(row))continue;
      const description=cells.get(`${descriptions[0].column}${row}`)?.raw;
      if(!String(description??"").trim())continue;
      const price=cells.get(`${prices[0].column}${row}`);
      const ref=/^=?\s*(?:'((?:[^']|'')+)'|([^'!]+))!\$?([A-Z]+)\$?(\d+)\s*$/.exec(price?.formula??"");
      const target=ref&&workbook.sheets.find(s=>s.sheetName===(ref[1]??ref[2]).replaceAll("''","'"));
      if(!ref||!target||!plan.blocks.some(b=>b.mainProject!==false&&b.target==="APU"&&b.sheet===target.sheetName&&Number(ref[4])>=b.headerRowStart&&Number(ref[4])<=b.dataRowEnd)){valid=false;break;}
      const end=Number(ref[4]),adopted=target.cells.find(c=>c.address===`${ref[3]}${end}`);
      const title=target.cells.filter(c=>c.column===1&&c.row<end&&/formulario.*composicion.*precios unitarios/.test(norm(c.raw))).at(-1);
      if(!title||typeof price?.raw!=="number"||adopted?.type==="e"||adopted?.raw!==price.raw||!target.cells.some(c=>c.row===end&&/costo unitario adoptado/.test(norm(c.raw)))){valid=false;break;}
      const form=target.cells.filter(c=>c.row>=title.row&&c.row<end);
      const identities=form.flatMap(c=>[...norm(c.raw).matchAll(/^item\s*n[°ºo.:\s]*(\d+)\s*$/g)].map(m=>m[1]));
      const rubro=form.find(c=>c.column===1&&/^rubro\s*:/.test(norm(c.raw)));
      const actual=String(cells.get(`${candidates[0]}${row}`)?.raw??"").trim();
      if(identities.length!==1||identities[0]!==actual||!rubro||norm(rubro.raw).replace(/^rubro\s*:\s*/,"")!==norm(description)){valid=false;break;}
      codes.push(actual);
    }
    if(!valid||!codes.length||new Set(codes).size!==codes.length)continue;
    const old=codeMappings[0].column;
    block.columnMappings=block.columnMappings.filter(m=>!(m.column===candidates[0]&&m.role==="ignore")).map(m=>m.role==="code"?{...m,column:candidates[0],notes:`Identidad corroborada con el número de ítem del APU y la fórmula de su precio; mapeo inicial ${old}.`}:m);
    block.needsReview=true;
    corrections.push(`${block.sheet}: se usa ${candidates[0]} como número de partida, corroborado con ${codes.length} APU y sus fórmulas de precio. La columna ${old} contiene códigos de catálogo y no identifica cada partida.`);
  }
  return {plan,corrections};
}
