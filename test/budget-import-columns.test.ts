import { expect,it } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const {autoDetectMapping}=sourceFunctions("app/(internal)/projects/[id]/import-budget-dialog.tsx",["HEADER_VARIANTS","normalize","autoDetectMapping"]);
it("#29 does not treat any header containing n as Código",()=>{
 expect(autoDetectMapping(["Descripción","Unidad","Cantidad","N°","Precio unitario","Fecha inicio"])).toEqual({
  0:"description",1:"unit",2:"quantity",3:"code",4:"unit_price",5:"start_date",
 });
});
it("#29 matches a real code label without stealing another field",()=>{
 expect(autoDetectMapping(["Código de partida","Descripción del rubro","Observación"])).toEqual({0:"code",1:"description",2:"ignore"});
});
