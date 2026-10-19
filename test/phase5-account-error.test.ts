import { expect,it,vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
const base="app/(internal)/";
function find(n:any,predicate:(n:any)=>boolean):any{
 if(!n||typeof n!=="object")return null;if(predicate(n))return n;
 for(const c of[n.props?.children].flat(Infinity)){const found=find(c,predicate);if(found)return found;}return null;
}
it("#9 failed account activation remains visible without refreshing as success",async()=>{
 const refresh=vi.fn(),setError=vi.fn();
 const {CuentaCard}=sourceFunctions(base+"tesoreria/tesoreria-section.tsx",["CuentaCard","TIPO_LABEL"],{
  useRouter:()=>({refresh}),useState:()=>[null,setError],setCuentaActiva:async()=>({error:"Cuenta bloqueada"}),
  formatMoney:String,Badge:"badge",MovimientoDialog:"movement",EditarCuentaDialog:"edit",
 });
 const node=CuentaCard({cuenta:{id:"c",nombre:"Cuenta",saldo:0,tipo:"BANCO",activo:true},proyectos:[]});
 await find(node,n=>n.type==="button").props.onClick();
 expect(refresh).not.toHaveBeenCalled();expect(setError).toHaveBeenCalledWith("Cuenta bloqueada");
});

