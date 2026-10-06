import type { ClimateEvent, ClimateEvidence, ProjectWorkdayStatus, WeatherCode } from "@/lib/types";
import { libroCode } from "@/lib/procurement/climate-calendar";

export const CONTRACT_CLIMATE_ENGINE = "EXCESS_ELIGIBLE_DAYS_V1";
export interface ContractClimateParameters {
  schemaVersion: 1;
  label: string; documentRef: string; clauseRef: string; effectiveFrom: string;
  startDate: string; baseDays: number | null; dayBasis: "CALENDAR" | "WORKING" | null;
  includeStart: boolean | null; workingWeekdays: number[]; holidays: string[];
  thresholdMm: number | null; thresholdOperator: "GT" | "GTE" | null;
  rainSource: "EXTERNAL" | "LOCAL" | "EITHER" | "NOT_REQUIRED" | null;
  sourceName: string; stationId: string;
  eligibleCodes: WeatherCode[]; otherReasons: string[];
  requireEvidence: boolean | null; requireCausality: boolean | null;
  requireImpediment: boolean | null; requireConformity: boolean | null;
  toleranceDays: number | null; toleranceScope: "MONTH" | "CONTRACT" | "PERIOD" | null;
  partialMonth: "FULL" | "PRORATA" | null;
  capMode: "NONE" | "LIMIT" | null; monthlyCap: number | null; totalCap: number | null;
  rounding: "FLOOR" | "CEIL" | "NEAREST" | null;
  formula: "EXCESS_ELIGIBLE_DAYS_V1" | "UNSUPPORTED" | null;
  unsupportedClause: string;
}
export interface ContractClimatePolicy {
  id: string; project_id: string; empresa_id: string; version: number;
  status: "DRAFT" | "VALIDATED"; parameters: ContractClimateParameters;
  created_at: string; created_by: string; validated_by: string | null;
}
export interface ContractDayAssessment {
  id: string; workday_id: string; impediment: boolean | null; conformity: boolean | null;
  workday_fingerprint: string; document_ref: string; notes: string; created_at: string;
}
export function contractWorkdayFingerprint(day: ProjectWorkdayStatus): string { return JSON.stringify([day.classification,day.reason_code,day.climate_event_id,day.parent_workday_status_id,day.decision_status,day.updated_at]); }
export interface ContractTimeAdjustment { id: string; days: number; document_ref: string; approved_date: string; created_at: string }
export interface ContractClimateDate {
  date: string; workdayId: string | null; code: WeatherCode | null; policyId: string | null;
  state: "ELIGIBLE" | "EXCLUDED" | "PENDING"; reason: string;
  evidenceIds: string[]; computableDays: number;
}
export interface ContractClimateResult {
  engine: string; status: "COMPLETE" | "PROVISIONAL" | "BLOCKED";
  periodStart: string; periodEnd: string; asOf: string; issues: string[];
  policyIds: string[]; dates: ContractClimateDate[];
  groups: { key: string; eligible: number; tolerance: number; computable: number }[];
  eligibleDays: number; computableDays: number; cumulativeComputableDays: number;
  baseDueDate: string | null; approvedDays: number; officialDueDate: string | null;
  proposedDueDate: string | null;
}
export function emptyContractClimateParameters(): ContractClimateParameters {
  return { schemaVersion: 1, label: "", documentRef: "", clauseRef: "", effectiveFrom: "", startDate: "",
    baseDays: null, dayBasis: null, includeStart: null, workingWeekdays: [], holidays: [],
    thresholdMm: null, thresholdOperator: null, rainSource: null, sourceName: "", stationId: "",
    eligibleCodes: [], otherReasons: [], requireEvidence: null, requireCausality: null,
    requireImpediment: null, requireConformity: null, toleranceDays: null, toleranceScope: null,
    partialMonth: null, capMode: null, monthlyCap: null, totalCap: null, rounding: null, formula: null, unsupportedClause: "" };
}
export function isContractDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
}
const addDay = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
const daysBetween = (a: string,b: string) => Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000)+1;
export function validateContractClimateParameters(raw: unknown, complete = false): string[] {
  const issues: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["Parámetros inválidos."];
  const p = raw as ContractClimateParameters;
  if (p.schemaVersion !== 1) issues.push("Versión de parámetros no soportada.");
  for (const key of ["label","documentRef","clauseRef","effectiveFrom","startDate","sourceName","stationId","unsupportedClause"] as const)
    if (typeof p[key] !== "string" || p[key].length > 4000) issues.push(`Campo inválido: ${key}.`);
  for (const key of ["baseDays","thresholdMm","toleranceDays","monthlyCap","totalCap"] as const)
    if (p[key] !== null && (typeof p[key] !== "number" || !Number.isFinite(p[key]) || p[key]! < 0 || p[key]! > 10000)) issues.push(`Número inválido: ${key}.`);
  for (const key of ["baseDays","monthlyCap","totalCap"] as const)
    if (p[key] !== null && !Number.isInteger(p[key])) issues.push(`Usá días enteros en ${key}.`);
  for (const [key, values] of Object.entries({ dayBasis:["CALENDAR","WORKING"], thresholdOperator:["GT","GTE"], rainSource:["EXTERNAL","LOCAL","EITHER","NOT_REQUIRED"], toleranceScope:["MONTH","CONTRACT","PERIOD"], partialMonth:["FULL","PRORATA"], capMode:["NONE","LIMIT"], rounding:["FLOOR","CEIL","NEAREST"], formula:[CONTRACT_CLIMATE_ENGINE,"UNSUPPORTED"] })) {
    const value=p[key as keyof ContractClimateParameters];
    if (value !== null && !values.includes(value as string)) issues.push(`Opción inválida: ${key}.`);
  }
  for (const key of ["includeStart","requireEvidence","requireCausality","requireImpediment","requireConformity"] as const)
    if (p[key] !== null && typeof p[key] !== "boolean") issues.push(`Opción inválida: ${key}.`);
  if (!Array.isArray(p.workingWeekdays) || p.workingWeekdays.some(x=>!Number.isInteger(x)||x<0||x>6) || new Set(p.workingWeekdays).size!==p.workingWeekdays?.length) issues.push("Calendario laboral inválido.");
  if (!Array.isArray(p.holidays) || p.holidays.some(x=>!isContractDate(x))) issues.push("Feriados inválidos.");
  if (!Array.isArray(p.eligibleCodes) || p.eligibleCodes.some(x=>!["LL","HH","O"].includes(x)) || new Set(p.eligibleCodes).size!==p.eligibleCodes?.length) issues.push("Tipos elegibles inválidos. B nunca es una jornada no trabajada.");
  if (!Array.isArray(p.otherReasons) || p.otherReasons.some(x=>!["TERRAIN_SATURATED","ACCESS_BLOCKED","FLOODED_EXCAVATION","UNSAFE_CONDITIONS","MATERIAL_IMPACT","OTHER"].includes(x))) issues.push("Causas O inválidas.");
  for (const key of ["startDate","effectiveFrom"] as const) if (p[key] && !isContractDate(p[key])) issues.push(`Fecha inválida: ${key}.`);
  if (issues.length || !complete) return issues;
  if (!p.label.trim() || !p.documentRef.trim() || !p.clauseRef.trim()) issues.push("Indicá nombre, documento y cláusula del PBC/adenda.");
  if (!isContractDate(p.startDate) || !isContractDate(p.effectiveFrom)) issues.push("Indicá inicio contractual y vigencia.");
  if (!p.baseDays || !p.dayBasis || p.includeStart===null) issues.push("Completá plazo y convención de inicio.");
  if (p.dayBasis==="WORKING" && !p.workingWeekdays.length) issues.push("Definí los días laborales.");
  if (!p.eligibleCodes.length) issues.push("Definí los tipos elegibles.");
  if (p.eligibleCodes.includes("LL") && (!p.rainSource || (p.rainSource!=="NOT_REQUIRED" && (p.thresholdMm===null || !p.thresholdOperator)))) issues.push("Completá fuente, umbral y operador de lluvia.");
  if (p.eligibleCodes.includes("O") && !p.otherReasons.length) issues.push("Definí las causas O admitidas.");
  if ([p.requireEvidence,p.requireCausality,p.requireImpediment,p.requireConformity].some(x=>x===null)) issues.push("Definí evidencia, causalidad, impedimento y conformidad.");
  if (p.toleranceDays===null || !p.toleranceScope || (p.toleranceScope==="MONTH" && !p.partialMonth)) issues.push("Completá tolerancia, agrupación y tratamiento de meses parciales.");
  if (!p.capMode || (p.capMode==="LIMIT" && p.monthlyCap===null && p.totalCap===null)) issues.push("Indicá sin límite o al menos un tope.");
  if (!p.rounding) issues.push("Definí redondeo de los días computables.");
  if (p.formula!==CONTRACT_CLIMATE_ENGINE) issues.push("Fórmula no soportada o sin definir. Conservá la cláusula para revisión.");
  return issues;
}
function isWorking(date: string,p: ContractClimateParameters) {
  return p.dayBasis==="CALENDAR" || p.workingWeekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && !p.holidays.includes(date);
}
export function contractDueDate(p: ContractClimateParameters, extraDays=0): string {
  let date=p.startDate, remaining=(p.baseDays??0)+extraDays;
  if (!p.includeStart) date=addDay(date);
  for(let attempts=0;attempts<75000;attempts++,date=addDay(date)) if(isWorking(date,p)&&--remaining<=0)return date;
  throw new Error("Calendario contractual fuera de rango.");
}
export function evaluateContractClimate(input: {
  policies: ContractClimatePolicy[]; workdays: ProjectWorkdayStatus[]; events: ClimateEvent[];
  evidence: ClimateEvidence[]; assessments: ContractDayAssessment[]; adjustments: ContractTimeAdjustment[];
  periodStart: string; periodEnd: string; asOf: string;
}): ContractClimateResult {
  const {periodStart,periodEnd,asOf}=input;
  const out:ContractClimateResult={engine:CONTRACT_CLIMATE_ENGINE,status:"BLOCKED",periodStart,periodEnd,asOf,issues:[],policyIds:[],dates:[],groups:[],eligibleDays:0,computableDays:0,cumulativeComputableDays:0,baseDueDate:null,approvedDays:0,officialDueDate:null,proposedDueDate:null};
  if (![periodStart,periodEnd,asOf].every(isContractDate) || periodStart>periodEnd || periodEnd>asOf) {out.issues.push("Elegí un período válido, hasta la fecha de corte.");return out;}
  const validated=input.policies.filter(p=>p.status==="VALIDATED");
  if (!validated.length) {out.issues.push("No hay parámetros del PBC validados.");return out;}
  for(const policy of validated) {const issues=validateContractClimateParameters(policy.parameters,true);if(issues.length){out.issues.push(`Versión ${policy.version}: ${issues.join(" ")}`);return out;}}
  const latestByDate=new Map<string,ContractClimatePolicy>();
  validated.sort((a,b)=>a.version-b.version).forEach(p=>latestByDate.set(p.parameters.effectiveFrom,p));
  const policies=[...latestByDate.values()].sort((a,b)=>a.parameters.effectiveFrom.localeCompare(b.parameters.effectiveFrom));
  const resolve=(date:string)=>policies.filter(p=>p.parameters.effectiveFrom<=date).at(-1);
  const first=policies[0].parameters;
  if(periodStart<first.startDate || !resolve(first.startDate) || daysBetween(first.startDate,periodEnd)>10000){out.issues.push("Período fuera del inicio/plazo de cálculo o sin versión vigente al inicio.");return out;}
  const inRange=policies.filter(p=>p.parameters.effectiveFrom<=periodEnd);
  // Changing an accumulator mid-period requires a separately reviewed formula.
  const ruleSignature=(p:ContractClimateParameters)=>JSON.stringify([p.startDate,p.baseDays,p.dayBasis,p.includeStart,p.workingWeekdays,p.holidays,p.toleranceScope,p.toleranceDays,p.partialMonth,p.capMode,p.monthlyCap,p.totalCap,p.rounding]);
  if(inRange.some(p=>ruleSignature(p.parameters)!==ruleSignature(first))){out.issues.push("La adenda cambia plazo/tolerancias acumuladas. Esta fórmula no admite mezclar acumuladores: requiere revisión específica.");return out;}
  out.baseDueDate=contractDueDate(first);
  out.approvedDays=input.adjustments.filter(a=>a.approved_date<=asOf).reduce((sum,a)=>sum+Number(a.days),0);
  out.officialDueDate=contractDueDate(first,out.approvedDays);
  const byDate=new Map<string,ProjectWorkdayStatus>();
  for(const day of input.workdays){if(byDate.has(day.work_date)){out.issues.push(`Jornadas duplicadas: ${day.work_date}.`);return out;}byDate.set(day.work_date,day);}
  const byId=new Map(input.workdays.map(d=>[d.id,d]));
  const assessed=new Map<string,ContractDayAssessment>();
  [...input.assessments].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)).forEach(a=>assessed.set(a.workday_id,a));
  const allDates:ContractClimateDate[]=[];
  for(let date=first.startDate;date<=periodEnd;date=addDay(date)){
    const policy=resolve(date)!,p=policy.parameters,day=byDate.get(date);
    const code=day?libroCode(day):null;
    const row:ContractClimateDate={date,workdayId:day?.id??null,code,policyId:policy.id,state:"EXCLUDED",reason:"Día practicable o no admitido por el PBC.",evidenceIds:[],computableDays:0};
    if (!isWorking(date,p)) row.reason="Día fuera del calendario laboral contractual.";
    else if(!day || day.decision_status!=="CONFIRMED" || !day.confirmed_at) {row.state="PENDING";row.reason=day?"Falta confirmación humana trazable.":"Día sin clasificación confirmada.";}
    else if(code && p.eligibleCodes.includes(code)){
      row.state="ELIGIBLE";row.reason="Cumple las reglas configuradas.";
      const event=input.events.find(e=>e.id===day.climate_event_id || e.event_date===date);
      const evidence=input.evidence.filter(e=>e.workday_status_id===day.id || !!event && e.climate_event_id===event.id);
      row.evidenceIds=evidence.map(e=>e.id);
      const recordedAssessment=assessed.get(day.id);
      const assessment=recordedAssessment?.workday_fingerprint===contractWorkdayFingerprint(day)?recordedAssessment:undefined;
      const pending=(reason:string)=>{row.state="PENDING";row.reason=reason;};
      if(code==="O" && (!day.reason_code || !p.otherReasons.includes(day.reason_code))){row.state="EXCLUDED";row.reason="Causa O fuera del catálogo del PBC.";}
      if(row.state==="ELIGIBLE" && code==="O" && day.reason_code==="OTHER" && !day.notes?.trim())pending("Falta describir/documentar la otra causa de la jornada.");
      if(row.state==="ELIGIBLE" && p.requireEvidence && !evidence.length) pending("Falta evidencia exigida por el PBC.");
      if(row.state==="ELIGIBLE" && p.requireImpediment && assessment?.impediment!==true) {if(assessment?.impediment===false){row.state="EXCLUDED";row.reason="Sin impedimento efectivo acreditado.";}else pending("Falta valoración del impedimento efectivo.");}
      if(row.state==="ELIGIBLE" && p.requireConformity && (assessment?.conformity!==true || !assessment.document_ref.trim())) {if(assessment?.conformity===false){row.state="EXCLUDED";row.reason="Sin conformidad de fiscalización.";}else pending("Falta conformidad y referencia documental.");}
      if(row.state==="ELIGIBLE" && code==="HH" && p.requireCausality){const parent=day.parent_workday_status_id?byId.get(day.parent_workday_status_id):undefined;if(!parent || parent.decision_status!=="CONFIRMED" || parent.classification!=="NON_WORKABLE_RAIN" || parent.work_date>=date)pending("HH sin jornada de lluvia causal confirmada anterior.");}
      if(row.state==="ELIGIBLE" && code==="LL" && p.rainSource!=="NOT_REQUIRED"){
        const threshold=(mm:number|null|undefined)=>mm!=null && (p.thresholdOperator==="GT"?mm>p.thresholdMm!:mm>=p.thresholdMm!);
        const extAllowed=!!event && (!p.sourceName.trim() || event.source===p.sourceName.trim()) && (!p.stationId.trim() || event.external_station_id===p.stationId.trim());
        const ext=extAllowed?event?.external_precipitation_mm:null,local=event?.local_precipitation_mm;
        const values=p.rainSource==="EXTERNAL"?[ext]:p.rainSource==="LOCAL"?[local]:[ext,local];
        if(values.some(threshold)) {
          // One accepted source is enough when the PBC allows either source.
        } else if(values.some(x=>x==null)) {
          // Missing data is unknown, not proof that the threshold was missed.
          pending("Falta medición de la fuente/estación exigida.");
        } else {
          row.state="EXCLUDED";row.reason="La precipitación no supera el umbral configurado.";
        }
      }
    }
    allDates.push(row);
  }
  const groups=new Map<string,ContractClimateDate[]>();
  for(const row of allDates){if(first.toleranceScope==="PERIOD" && row.date<periodStart)continue;const key=first.toleranceScope==="MONTH"?row.date.slice(0,7):first.toleranceScope!;groups.set(key,[...(groups.get(key)??[]),row]);}
  let total=0;const monthlyUsed=new Map<string,number>();
  const round=(n:number)=>first.rounding==="CEIL"?Math.ceil(n):first.rounding==="FLOOR"?Math.floor(n):Math.round(n);
  for(const [key,rows] of groups){
    const eligible=rows.filter(r=>r.state==="ELIGIBLE");let tolerance=first.toleranceDays!;
    if(first.toleranceScope==="MONTH" && first.partialMonth==="PRORATA"){
      const monthStart=`${key}-01`,monthEnd=new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7)),0)).toISOString().slice(0,10);
      const activeStart=first.startDate>monthStart?first.startDate:monthStart,activeEnd=out.baseDueDate!<monthEnd?out.baseDueDate!:monthEnd;
      tolerance*=Math.max(0,daysBetween(activeStart,activeEnd))/daysBetween(monthStart,monthEnd);
    }
    let remaining=round(Math.max(0,eligible.length-tolerance)),assigned=0;
    // Attribute computable excess to the final eligible dates; one unit per date.
    const excessDates=eligible.slice(Math.max(0,eligible.length-remaining));
    for(const row of excessDates){const month=row.date.slice(0,7),used=monthlyUsed.get(month)??0;
      if(first.capMode==="LIMIT" && (first.monthlyCap!==null && used>=first.monthlyCap || first.totalCap!==null && total>=first.totalCap))continue;
      row.computableDays=1;assigned++;total++;monthlyUsed.set(month,used+1);
    }
    out.groups.push({key,eligible:eligible.length,tolerance:Number(tolerance.toFixed(6)),computable:assigned});
  }
  out.dates=allDates.filter(r=>r.date>=periodStart);
  out.policyIds=[...new Set(allDates.map(r=>r.policyId!))];
  out.eligibleDays=out.dates.filter(r=>r.state==="ELIGIBLE").length;
  out.computableDays=out.dates.reduce((s,r)=>s+r.computableDays,0);out.cumulativeComputableDays=total;
  const unknown=allDates.filter(r=>r.state==="PENDING");
  if(unknown.length)out.issues.push(`${unknown.length} días pendientes en el intervalo necesario para aplicar tolerancias.`);
  out.status=unknown.length?"PROVISIONAL":"COMPLETE";
  out.proposedDueDate=contractDueDate(first,total);
  return out;
}
