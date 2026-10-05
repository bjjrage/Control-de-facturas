"use server";

import { createHash } from "node:crypto";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/cashflow/load";
import { climateToday } from "@/lib/procurement/climate-entry";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import type { ClimateEvent, ClimateEvidence, ProjectWorkdayStatus, ProjectCertificate } from "@/lib/types";
import { contractWorkdayFingerprint, evaluateContractClimate, isContractDate, validateContractClimateParameters,
  type ContractClimateParameters, type ContractClimatePolicy, type ContractDayAssessment, type ContractTimeAdjustment } from "@/lib/projects/contract-climate";

async function owned(projectId: string) {
  const profile=await requirePlan("pro",["administracion","admin"]);
  const db=await createClient();
  const {data,error}=await db.from("projects").select("id,empresa_id").eq("id",projectId).eq("empresa_id",profile.empresa_id).single();
  if(error || !data)throw new Error("Proyecto no encontrado o sin autorización.");
  return {db,profile};
}
async function readContext(projectId:string) {
  const {db,profile}=await owned(projectId);
  const rows=<T>(table:string)=>readAll<T>((from,to)=>db.from(table).select("*").eq("project_id",projectId).eq("empresa_id",profile.empresa_id).order("id").range(from,to));
  const [policies,workdays,events,evidence,assessments,adjustments]=await Promise.all([
    rows<ContractClimatePolicy>("contract_climate_policy_versions"),rows<ProjectWorkdayStatus>("project_workday_status"),
    rows<ClimateEvent>("climate_events"),rows<ClimateEvidence>("climate_evidence"),
    rows<ContractDayAssessment>("contract_day_assessments"),rows<ContractTimeAdjustment>("contract_time_adjustments"),
  ]);
  return {db,profile,policies,workdays,events,evidence,assessments,adjustments};
}
const message=(error:unknown)=>error instanceof Error?error.message:"No se pudo completar la operación.";

export async function loadContractClimate(projectId:string) {
  try {
    const context=await readContext(projectId);
    const certificates=await readAll<Pick<ProjectCertificate,"id"|"numero"|"status"|"period_start"|"period_end">>((from,to)=>context.db.from("project_certificates")
      .select("id,numero,status,period_start,period_end").eq("project_id",projectId).order("id").range(from,to));
    return {error:null,data:{policies:context.policies.sort((a,b)=>b.version-a.version),assessments:context.assessments,adjustments:context.adjustments,certificates}};
  } catch(error) {return {error:message(error),data:null};}
}

export async function saveContractClimatePolicy(projectId:string,parameters:ContractClimateParameters,status:"DRAFT"|"VALIDATED") {
  try {
    const {db,profile}=await owned(projectId);
    if(!["DRAFT","VALIDATED"].includes(status))return {error:"Estado inválido.",data:null};
    const issues=validateContractClimateParameters(parameters,status==="VALIDATED");
    if(issues.length)return {error:issues.join(" "),data:null};
    const {data,error}=await db.from("contract_climate_policy_versions").insert({project_id:projectId,empresa_id:profile.empresa_id,
      created_by:profile.id,version:0,status,parameters}).select("*").single<ContractClimatePolicy>();
    if(error || !data)return {error:error?.message??"No se pudo guardar la versión.",data:null};
    await logAudit(db,{action:"contract_climate.policy_created",detail:{project_id:projectId,policy_id:data.id,version:data.version,status}});
    revalidatePath(`/projects/${projectId}`);
    return {error:null,data};
  } catch(error) {return {error:message(error),data:null};}
}

export async function calculateContractClimate(projectId:string,periodStart:string,periodEnd:string) {
  try {const context=await readContext(projectId);return {error:null,data:evaluateContractClimate({...context,periodStart,periodEnd,asOf:climateToday()})};}
  catch(error){return {error:message(error),data:null};}
}

export async function saveContractDayAssessment(projectId:string,workdayId:string,input:{impediment:boolean|null;conformity:boolean|null;documentRef:string;notes:string}) {
  try {
    const {db,profile}=await owned(projectId);
    if(!input || ![input.impediment,input.conformity].every(x=>x===null||typeof x==="boolean") || typeof input.documentRef!=="string" || typeof input.notes!=="string" || input.documentRef.length>4000 || input.notes.length>4000)
      return {error:"Valoración inválida."};
    if(input.conformity===true && !input.documentRef.trim())return {error:"Indicá el documento que acredita la conformidad."};
    const {data:day}=await db.from("project_workday_status").select("*").eq("id",workdayId).eq("project_id",projectId).eq("empresa_id",profile.empresa_id).single<ProjectWorkdayStatus>();
    if(!day || day.decision_status!=="CONFIRMED")return {error:"La jornada debe estar confirmada y pertenecer al proyecto."};
    const {error}=await db.from("contract_day_assessments").insert({project_id:projectId,empresa_id:profile.empresa_id,created_by:profile.id,
      workday_id:day.id,workday_fingerprint:contractWorkdayFingerprint(day),impediment:input.impediment,conformity:input.conformity,document_ref:input.documentRef.trim(),notes:input.notes.trim()});
    if(error)return {error:error.message};
    revalidatePath(`/projects/${projectId}`);return {error:null};
  }catch(error){return {error:message(error)};}
}

export async function recordContractTimeAdjustment(projectId:string,input:{days:number;documentRef:string;approvedDate:string}) {
  try {
    const {db,profile}=await owned(projectId);
    if(!input || !Number.isInteger(input.days) || input.days<=0 || input.days>10000 || typeof input.documentRef!=="string" || !input.documentRef.trim() || input.documentRef.length>4000 || !isContractDate(input.approvedDate) || input.approvedDate>climateToday())return {error:"Completá días, documento y fecha de aprobación válida."};
    const {error}=await db.from("contract_time_adjustments").insert({project_id:projectId,empresa_id:profile.empresa_id,created_by:profile.id,
      days:input.days,document_ref:input.documentRef.trim(),approved_date:input.approvedDate});
    if(error)return {error:error.code==="23505"?"Ese documento de prórroga ya está registrado.":error.message};
    await logAudit(db,{action:"contract_climate.approved_adjustment_recorded",detail:{project_id:projectId,days:input.days,document_ref:input.documentRef}});
    revalidatePath(`/projects/${projectId}`);return {error:null};
  }catch(error){return {error:message(error)};}
}

export async function attachContractClimateToCertificate(projectId:string,certificateId:string) {
  try {
    const context=await readContext(projectId);
    const {data:cert}=await context.db.from("project_certificates").select("id,status,period_start,period_end").eq("id",certificateId).eq("project_id",projectId).single();
    if(!cert || cert.status!=="BORRADOR")return {error:"Elegí un certificado borrador del mismo proyecto."};
    const result=evaluateContractClimate({...context,periodStart:cert.period_start,periodEnd:cert.period_end,asOf:climateToday()});
    if(result.status!=="COMPLETE")return {error:`El anexo no está completo: ${result.issues.join(" ")}`};
    const inputs={policies:context.policies,workdays:context.workdays,events:context.events,evidence:context.evidence,assessments:context.assessments,adjustments:context.adjustments};
    const inputHash=createHash("sha256").update(JSON.stringify({inputs,result})).digest("hex");
    const {error}=await context.db.from("certificate_climate_snapshots").insert({project_id:projectId,empresa_id:context.profile.empresa_id,
      certificate_id:certificateId,created_by:context.profile.id,input_hash:inputHash,snapshot:{inputs,result}});
    if(error)return {error:error.message};
    await logAudit(context.db,{action:"contract_climate.certificate_annex_attached",detail:{project_id:projectId,certificate_id:certificateId,input_hash:inputHash}});
    revalidatePath(`/projects/${projectId}`);return {error:null};
  }catch(error){return {error:message(error)};}
}
