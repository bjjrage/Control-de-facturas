import { expect,it } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const {parseNumber}=sourceFunctions("app/(internal)/projects/[id]/paste-avance-dialog.tsx",["parseNumber"]);
it("#31 blocks a pasted ambiguous 1.234 instead of silently reading 1.234 units",()=>{expect(parseNumber("1.234")).toBeNull()});
it("#31 preserves explicit decimals and rejects malformed text",()=>{
 expect(parseNumber("2.5")).toBe(2.5);expect(parseNumber("1.234,56")).toBe(1234.56);
 expect(parseNumber("1,234.56")).toBe(1234.56);expect(parseNumber("2.5x")).toBeNull();
});
