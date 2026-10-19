import {expect,it} from "vitest";
import {parseParaguayNumber} from "../lib/spreadsheet-number-format";
import {sourceFunctions} from "./support/source-functions";
it.each([
 ["import-budget-dialog.tsx","parsePyNumber"],
 ["import-recipe-dialog.tsx","parsePyNumber"],
 ["paste-avance-dialog.tsx","parseNumber"],
])("explicit PY choice changes text interpretation in %s",(file,name)=>{
 const parse=sourceFunctions("app/(internal)/projects/[id]/"+file,[name],{parseParaguayNumber})[name];
 expect(parse("350.000")).toBeNull();
 expect(parse("350.000","py")).toBe(350000);
 expect(parse("1.234,56","py")).toBe(1234.56);
 expect(parse("2.5","py")).toBeNull();
 expect(parse(2.5,"py")).toBe(2.5);
 expect(parse("2.5")).toBe(2.5);
});
it.each(["35.00","1.234.56","1,2,3","","abc"])("PY choice still rejects malformed %s",text=>{
 expect(parseParaguayNumber(text)).toBeNull();
});
