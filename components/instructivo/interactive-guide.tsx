"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Select } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, ExternalLink, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { GUIDES, JOURNEYS, MODULES, normalizePractice, validatePractice, type PracticeGuide } from "@/lib/instructivo/content";
import { getLearningSnapshot, isGuideComplete, markLearningStep, readLearningProgress, saveLearningProgress, subscribeLearningProgress } from "@/lib/instructivo/progress";
import styles from "./interactive-guide.module.css";

const subscribeHash=(changed:()=>void)=>{window.addEventListener("hashchange",changed);return ()=>window.removeEventListener("hashchange",changed);};
const hashSnapshot=()=>window.location.hash;
const serverSnapshot=()=>"";
function practiceHash(id:string,index=0,journey?:string) { return `#guia/${id}/${index+1}${journey?`/${journey}`:""}`; }
function changePracticeHash(hash:string) {
  if(window.location.hash===hash)return;
  window.history.pushState(null,"",hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function InteractiveGuide({storageKey}:{storageKey:string}) {
  const subscribe=useCallback((changed:()=>void)=>subscribeLearningProgress(storageKey,changed),[storageKey]);
  const snapshot=useCallback(()=>getLearningSnapshot(storageKey),[storageKey]);
  const raw=useSyncExternalStore(subscribe,snapshot,serverSnapshot);
  const progress=useMemo(()=>readLearningProgress(raw),[raw]);
  const hash=useSyncExternalStore(subscribeHash,hashSnapshot,serverSnapshot);
  const [query,setQuery]=useState("");
  const [module,setModule]=useState("");
  const [role,setRole]=useState("");
  const [resetRequested,setResetRequested]=useState(false);
  const [kind,id,stepValue,journeyId]=hash.slice(1).split("/");
  const current=kind==="guia"?GUIDES.find(g=>g.id===id):undefined;
  const index=current?Math.min(Math.max(Number.isFinite(Number(stepValue))?Math.trunc(Number(stepValue))-1:0,0),current.steps.length-1):0;
  const journey=JOURNEYS.find(j=>j.id===journeyId&&j.ids.includes(id));
  const titleRef=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{titleRef.current?.focus({preventScroll:true});},[id,index,kind]);
  const completedCount=GUIDES.filter(g=>isGuideComplete(progress,g.id)).length;
  const navigate=(guide:PracticeGuide,step=0,journey?:string)=>{
    saveLearningProgress(storageKey,{...progress,last:{id:guide.id,step}});
    changePracticeHash(practiceHash(guide.id,step,journey));
    window.scrollTo({top:0,behavior:"instant"});
  };
  const home=()=>{changePracticeHash("#inicio");setResetRequested(false);};
  const filtered=GUIDES.filter(g=>(!module||g.module===module)&&(!role||g.roles.includes(role))&&(!query||normalizePractice([g.title,g.path,g.description,...g.steps.flatMap(s=>[s.title,s.instruction])].join(" ")).includes(normalizePractice(query))));
  const guideCard=(g:PracticeGuide)=><button key={g.id} type="button" className={styles.card} onClick={()=>navigate(g)} data-guide={g.id}>
    <span className={styles.cardTop}>{g.module}{isGuideComplete(progress,g.id)&&<span className={styles.complete}><Check size={13} /> Completada</span>}</span>
    <h3>{g.title}</h3><p>{g.description}</p><span className={styles.cardBottom}>{g.steps.length} pasos <span>Practicar <ArrowRight size={14}/></span></span>
  </button>;
  return <div className={styles.guide} data-testid="interactive-guide">
    <header className={styles.header}><button type="button" className={styles.brand} onClick={home}><BookOpen size={20}/><span>Aprender a usar la app</span></button><div className={styles.overall}><span>{completedCount} de {GUIDES.length} prácticas completadas</span><progress value={completedCount} max={GUIDES.length} aria-label="Prácticas completadas"/></div></header>
    {current?<>
      <div className={styles.breadcrumb}><button type="button" onClick={home}><ArrowLeft size={14}/> Biblioteca</button><ChevronRight size={13}/><span>{current.module}</span></div>
      <div className={styles.lessonHeading}><div><span className={styles.kicker}>{current.roles.join(" · ")} · {current.plan}</span><h1 ref={titleRef} tabIndex={-1}>{current.title}</h1><p>{current.description}</p></div><button type="button" className={styles.secondary} onClick={()=>setResetRequested(true)}><RotateCcw size={14}/> Repetir práctica</button></div>
      {resetRequested&&<div className={styles.reset} role="group" aria-label="Confirmar repetición"><p>Se borran los pasos completados de esta práctica. Las demás se conservan.</p><button type="button" className={styles.secondary} onClick={()=>setResetRequested(false)}>Cancelar</button><button type="button" className={styles.primary} onClick={()=>{saveLearningProgress(storageKey,{...progress,done:{...progress.done,[current.id]:[]},last:{id:current.id,step:0}});changePracticeHash(practiceHash(current.id,0,journey?.id));setResetRequested(false);}}>Reiniciar esta práctica</button></div>}
      {journey&&<div className={styles.routeStrip}><span>{journey.title}</span><strong>Etapa {journey.ids.indexOf(current.id)+1} de {journey.ids.length}</strong><button type="button" onClick={()=>navigate(current,index)}>Salir del recorrido</button></div>}
      <div className={styles.learning}>
        <Practice key={`${current.id}:${index}`} guide={current} index={index} done={Boolean(progress.done[current.id]?.includes(index))} onComplete={()=>saveLearningProgress(storageKey,markLearningStep(progress,current.id,index))}/>
        <aside className={styles.coach} aria-label="Instrucciones de la práctica"><span className={styles.kicker}>Paso {index+1} de {current.steps.length}</span><progress value={index+1} max={current.steps.length} aria-label="Posición en la práctica"/><h2>{current.steps[index].title}</h2><p>{current.steps[index].instruction}</p><div className={styles.expectation}><strong>Qué debe pasar</strong><p>{current.steps[index].result}</p></div><ol className={styles.steps}>{current.steps.map((s,i)=><li key={s.title}><button type="button" aria-current={i===index?"step":undefined} onClick={()=>navigate(current,i,journey?.id)}><span>{progress.done[current.id]?.includes(i)?<Check size={13}/>:i+1}</span>{s.title}</button></li>)}</ol><details><summary>Antes de empezar en la app real</summary><p>{current.requirements}</p>{current.notes.map(n=><p key={n}>{n}</p>)}</details></aside>
      </div>
      <footer className={styles.lessonFooter}><button type="button" className={styles.secondary} disabled={index===0} onClick={()=>navigate(current,index-1,journey?.id)}><ArrowLeft size={14}/> Anterior</button><span>Realizá la acción del ejercicio para continuar.</span><button type="button" className={styles.primary} data-testid="practice-next" disabled={!progress.done[current.id]?.includes(index)} onClick={()=>{
        if(index<current.steps.length-1)navigate(current,index+1,journey?.id);
        else {const missing=current.steps.findIndex((_,i)=>!progress.done[current.id]?.includes(i));if(missing>=0)navigate(current,missing,journey?.id);else changePracticeHash(`#final/${current.id}${journey?`/${journey.id}`:""}`);}
      }}>{index===current.steps.length-1?"Completar práctica":"Continuar"}<ArrowRight size={15}/></button></footer>
    </>:kind==="final"&&GUIDES.some(g=>g.id===id)&&isGuideComplete(progress,id)?(()=>{
      const g=GUIDES.find(g=>g.id===id)!;
      const j=JOURNEYS.find(j=>j.id===stepValue&&j.ids.includes(id));
      const nextId=j?.ids[j.ids.indexOf(id)+1];const next=GUIDES.find(g=>g.id===nextId);
      return <section className={styles.celebrate} data-testid="practice-complete"><span className={styles.check}><Check size={32}/></span><span className={styles.kicker}>Práctica completada</span><h1 ref={titleRef} tabIndex={-1}>{g.title}</h1><p>Completaste {g.steps.length} pasos con datos de ejemplo. La operación real se realiza en su módulo, con sus permisos y confirmaciones.</p><div className={styles.actions}>{next?<button type="button" className={styles.primary} onClick={()=>navigate(next,0,j?.id)}>Seguir: {next.title}<ArrowRight size={15}/></button>:<button type="button" className={styles.primary} onClick={home}>Elegir otra práctica</button>}<Link prefetch={false} href={g.href} target="_blank" rel="noopener noreferrer" className={styles.secondary}>{g.href==="/projects"?"Elegir una obra real":"Abrir módulo real"}<ExternalLink size={14}/></Link><button type="button" className={styles.secondary} onClick={()=>navigate(g)}>Repasar los pasos</button></div></section>;
    })():<>
      <section className={styles.hero}><div><span className={styles.kicker}>Del primer paso al trabajo diario</span><h1 ref={titleRef} tabIndex={-1}>Aprendé haciendo.</h1><p>Probá los módulos con una obra de ejemplo. Te mostramos dónde entrar, qué completar y cómo reconocer el resultado.</p><button type="button" className={styles.primary} onClick={()=>navigate(GUIDES.find(g=>g.id===JOURNEYS[0].ids[0])!,0,JOURNEYS[0].id)}>Empezar mi primera obra<ArrowRight size={16}/></button></div><div className={styles.flow} aria-label="Flujo de una obra">{["Preparar","Comprar","Avanzar","Certificar"].map((x,i)=><div key={x}><span>{String(i+1).padStart(2,"0")}</span><strong>{x}</strong></div>)}</div></section>
      <p className={styles.safe}><ShieldCheck size={17}/><span><strong>Práctica con datos ficticios.</strong> Los ejercicios no crean documentos, no envían correos y no modifican la empresa. Solo se guarda tu progreso en este navegador cuando el almacenamiento está disponible.</span></p>
      {progress.last&&<div className={styles.resume}><span>Seguí donde quedaste: <strong>{GUIDES.find(g=>g.id===progress.last?.id)?.title}</strong></span><button type="button" className={styles.secondary} onClick={()=>navigate(GUIDES.find(g=>g.id===progress.last?.id)!,progress.last!.step)}>Retomar<ArrowRight size={14}/></button></div>}
      <div className={styles.sectionHeading}><h2>Un recorrido, en el orden correcto</h2><span>De una tarea a la siguiente</span></div><div className={styles.journeys}>{JOURNEYS.map((j,i)=><button type="button" key={j.id} onClick={()=>navigate(GUIDES.find(g=>g.id===j.ids[0])!,0,j.id)}><span className={styles.kicker}>Recorrido 0{i+1}</span><h3>{j.title}<ArrowRight size={16}/></h3><p>{j.description}</p><small>{j.ids.length} prácticas</small></button>)}</div>
      <div className={styles.sectionHeading}><h2>O elegí una tarea</h2><span>{filtered.length} prácticas</span></div>
      <div className={styles.filters}><label className={styles.search}><Search size={16}/><span className={styles.srOnly}>Buscar una tarea</span><input type="search" aria-label="Buscar una tarea" placeholder="Buscá: factura, plan semanal, stock…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label><span className={styles.srOnly}>Filtrar por rol</span><Select aria-label="Filtrar por rol" value={role} onChange={e=>setRole(e.target.value)}><option value="">Todos los roles</option>{["Comercial",...adminRolesForFilter].map(r=><option key={r}>{r}</option>)}</Select></label></div>
      <div className={styles.modules} aria-label="Módulos de aprendizaje">{["",...MODULES].map(m=><button type="button" key={m} aria-pressed={module===m} onClick={()=>setModule(m)}>{m||"Todos"}</button>)}</div>
      {filtered.length?<div className={styles.cards}>{filtered.map(guideCard)}</div>:<div className={styles.empty}><h3>No encontramos esa tarea</h3><p>Probá otra palabra o quitá los filtros.</p><button type="button" className={styles.secondary} onClick={()=>{setQuery("");setModule("");setRole("");}}>Quitar filtros</button></div>}
      <p className={styles.note}>Los roles del filtro indican quién usa la función en la app real. Las prácticas están disponibles para aprender; no habilitan planes, módulos ni permisos.</p>
    </>}
  </div>;
}
const adminRolesForFilter=["Administración","Admin"];

function Practice({guide,index,done,onComplete}:{guide:PracticeGuide;index:number;done:boolean;onComplete:()=>void}) {
  const step=guide.steps[index];
  const [values,setValues]=useState(()=>step.fields.map(()=>""));
  const [error,setError]=useState<string|null>(null);
  const fieldRefs=useRef<(HTMLLabelElement|null)[]>([]);
  return <section className={styles.practice} aria-label="Pantalla de práctica"><div className={styles.practiceTop}><strong>OBR-DEMO</strong><span>SIMULACIÓN · DATOS FICTICIOS</span></div><div className={styles.path}>{guide.path}</div><div className={styles.practiceBody}><span className={styles.kicker}>Una acción por paso</span><h2>{step.title}</h2><p>Representación simplificada del módulo. Los valores pertenecen al ejercicio.</p><form onSubmit={event=>{event.preventDefault();if(done)return;const message=validatePractice(step,values);setError(message);if(message){const i=step.fields.findIndex((f,i)=>validatePractice({...step,fields:[f]},[values[i]])!==null);fieldRefs.current[i]?.querySelector<HTMLElement>('[role="combobox"],input:not([aria-hidden="true"])')?.focus();return;}onComplete();}}>
    <div className={styles.fields}>{step.fields.map((f,i)=><label key={f.label} ref={el=>{fieldRefs.current[i]=el;}}>{f.label}{f.options?<Select aria-label={f.label} required value={done?f.sample:values[i]} onChange={e=>setValues(v=>v.map((x,j)=>j===i?e.target.value:x))} disabled={done}><option value="">Elegí una opción</option>{f.options.map(o=><option key={o}>{o}</option>)}</Select>:<input type={f.type??"text"} step={f.type==="number"?"any":undefined} required value={done?f.sample:values[i]} placeholder={f.sample} autoComplete="off" disabled={done} onChange={e=>setValues(v=>v.map((x,j)=>j===i?e.target.value:x))}/>}</label>)}</div>
    <div className={styles.actions}><button className={styles.primary} type="submit" data-testid="practice-action" disabled={done}>{done?<><Check size={15}/>Paso realizado</>:step.action}</button>{!done&&step.fields.length>0&&<button type="button" className={styles.example} onClick={()=>{setValues(step.fields.map(f=>f.sample));setError(null);}}>Usar datos de ejemplo</button>}</div><p className={styles.error} role="alert">{error}</p></form>
    {done&&<div className={styles.result} role="status" data-testid="practice-result"><strong><Check size={16}/> Resultado de la práctica</strong><p>{step.result}</p></div>}
    </div></section>;
}
