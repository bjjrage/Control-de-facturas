import { expect, it } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const { parsePyNumber } = sourceFunctions("app/(internal)/projects/[id]/import-budget-dialog.tsx", ["parsePyNumber"]);
it("#30 preserves a dot decimal instead of multiplying by ten",()=>{expect(parsePyNumber("2.5")).toBe(2.5)});
it.each(["1.234","1,234","1..2"])("#30 blocks ambiguous or invalid %s",value=>{expect(parsePyNumber(value)).toBeNull()});
it("#30 preserves typed Excel numbers and unambiguous grouped decimals",()=>{
 expect(parsePyNumber(1234)).toBe(1234);expect(parsePyNumber("1.234,56")).toBe(1234.56);
 expect(parsePyNumber("1,234.56")).toBe(1234.56);expect(parsePyNumber("1.250.000")).toBe(1250000);
});
