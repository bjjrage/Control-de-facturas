import { GUIDES } from "./content";

export type LearningProgress = { done: Record<string, number[]>; last?: {id: string; step: number} };
export function readLearningProgress(raw: string): LearningProgress {
  const empty = {done:{}};
  try {
    if(raw.length>100_000) return empty;
    const value: unknown=JSON.parse(raw||"{}");
    if(!value||typeof value!=="object") return empty;
    const data=value as {done?: Record<string,unknown>;last?:{id?:unknown;step?:unknown}};
    const done=Object.fromEntries(GUIDES.map(g=>[g.id,Array.isArray(data.done?.[g.id])?[...new Set((data.done[g.id] as unknown[]).filter((n):n is number=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<g.steps.length))].sort((a,b)=>a-b):[]]));
    const lastGuide=GUIDES.find(g=>g.id===data.last?.id);
    const last=lastGuide&&Number.isInteger(data.last?.step)&&Number(data.last?.step)>=0&&Number(data.last?.step)<lastGuide.steps.length?{id:lastGuide.id,step:Number(data.last?.step)}:undefined;
    return {done,...(last?{last}:{})};
  } catch { return empty; }
}
export function isGuideComplete(progress: LearningProgress, id: string) {
  const guide=GUIDES.find(g=>g.id===id);
  return Boolean(guide&&guide.steps.every((_,i)=>progress.done[id]?.includes(i)));
}
export function markLearningStep(progress: LearningProgress, id: string, index: number): LearningProgress {
  const guide=GUIDES.find(g=>g.id===id);
  if(!guide||!Number.isInteger(index)||index<0||index>=guide.steps.length)return progress;
  return {done:{...progress.done,[id]:[...new Set([...(progress.done[id]??[]),index])].sort((a,b)=>a-b)},last:{id,step:index}};
}
export function progressStorageKey(empresa: string, user: string) { return `control-facturas.instructivo.v1:${empresa}:${user}`; }

const memory=new Map<string,string>();
const eventName="control-facturas:learning-progress";
export function getLearningSnapshot(key: string) {
  if(typeof window==="undefined")return "";
  if(memory.has(key))return memory.get(key)!;
  try{return window.localStorage.getItem(key)??"";}catch{return "";}
}
export function saveLearningProgress(key: string, progress: LearningProgress) {
  const serialized=JSON.stringify(readLearningProgress(JSON.stringify(progress)));
  try { window.localStorage.setItem(key,serialized);memory.delete(key); }catch{memory.set(key,serialized);}
  window.dispatchEvent(new CustomEvent(eventName,{detail:key}));
}
export function subscribeLearningProgress(key: string, changed: ()=>void) {
  const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null){memory.delete(key);changed();}};
  const local=(event:Event)=>{if((event as CustomEvent<string>).detail===key)changed();};
  window.addEventListener("storage",storage);window.addEventListener(eventName,local);
  return ()=>{window.removeEventListener("storage",storage);window.removeEventListener(eventName,local);};
}
