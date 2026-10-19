import { expect,it,vi } from "vitest";
vi.mock("react",async original=>({...await original<typeof import("react")>(),useState:()=>["deleted-certificate",vi.fn()],useEffect:()=>{}}));
vi.mock("@/app/(internal)/projects/certificado-actions",()=>({}));
vi.mock("@/components/certificates/CertificateWorkbookSection",()=>({CertificateWorkbookSection:()=>null}));
import { CertificadosTable } from "@/app/(internal)/projects/[id]/certificados-table";
function details(node:any):any[]{
 if(!node||typeof node!=="object")return [];
 return [...(typeof node.type==="function"&&node.type.name==="CertificadoDetalle"?[node]:[]),
   ...[node.props?.children].flat(Infinity).flatMap(details)];
}
it("#28 never mounts details with an undefined certificate after deleting the open row",()=>{
 const tree=CertificadosTable({project:{id:"p",contract_amount:100,anticipo_pct:null} as never,
  certificates:[{id:"remaining",numero:2,status:"BORRADOR",devolucion_anticipo:0,retencion:0,penalidad_avance:0,penalidad_presentacion:0,ajustes:0,monto_presente:0,monto_liquido:0}] as never,
  itemsByCert:{},staffByCert:{},projectUnits:[],unitProgressByCert:{},isAdmin:false});
 expect(details(tree).some(element=>!element.props.certificate)).toBe(false);
});
