import {expect,it,vi} from "vitest";
import {sourceFunctions} from "./support/source-functions";
import {parseParaguayNumber} from "../lib/spreadsheet-number-format";
function all(n:any):any[]{return !n||typeof n!=="object"?[]:[n,...[n.props?.children].flat(Infinity).flatMap(all)]}
it("changing the budget selector revalidates the same textual rows without reparsing the file",()=>{
 let format="strict",index=0;
 const values=[true,"preview",null,false,[],null,"",[
  ["Código","Descripción","Cantidad","Precio","Importe"],["001","Material","350.000","2","700.000"],
 ],true,{0:"code",1:"description",2:"quantity",3:"unit_price",4:"line_total"}];
 const {ImportBudgetDialog}=sourceFunctions("app/(internal)/projects/[id]/import-budget-dialog.tsx",[
  "ImportBudgetDialog","parsePyNumber","parseDateCell","FIELD_LABELS",
 ],{
  useState:()=>{const i=index++;return[i===10?format:values[i],i===10?(v:string)=>{format=v}:vi.fn()]},
  useMemo:(fn:()=>unknown)=>fn(),parseParaguayNumber,Dialog:"dialog",DialogTrigger:"trigger",DialogContent:"content",
  Button:"button",InfoTooltip:"info",Select:"select",SpreadsheetNumberFormatSelect:"locale",formatMoney:String,
 });
 const render=()=>{index=0;return all(ImportBudgetDialog({projectId:"p"}))};
 const before=render();const button=(nodes:any[])=>nodes.find(n=>n.type==="button"&&String(n.props.children).includes("Importar 1"));
 expect(before.find(n=>n.type==="button"&&String(n.props.children).includes("Importar 0")).props.disabled).toBe(true);
 before.find(n=>n.type==="locale").props.onChange("py");
 const after=render();expect(button(after).props.disabled).toBe(false);
 expect(after.some(n=>n.type==="td"&&n.props.children===350000)).toBe(true);
});
