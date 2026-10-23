import {describe,expect,it} from "vitest";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {GUIDES,JOURNEYS,validatePractice} from "./content";
import {isGuideComplete,markLearningStep,progressStorageKey,readLearningProgress} from "./progress";

describe("catálogo y ejercicios de obra",()=>{
  it("tiene identificadores únicos, rutas y evidencia de código existente",()=>{
    expect(GUIDES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(GUIDES.map(g=>g.id)).size).toBe(GUIDES.length);
    for(const g of GUIDES){
      expect(g.steps.length,g.id).toBeGreaterThanOrEqual(3);
      expect(existsSync(resolve("app/(internal)",g.href.slice(1),"page.tsx")),g.href).toBe(true);
      for(const source of g.sources)expect(existsSync(resolve(source)),`${g.id}: ${source}`).toBe(true);
      for(const step of g.steps)expect(validatePractice(step,step.fields.map(f=>f.sample)),`${g.id}: ${step.title}`).toBeNull();
    }
  });
  it("cada recorrido tiene etapas existentes y sin repeticiones",()=>{
    for(const journey of JOURNEYS){expect(new Set(journey.ids).size).toBe(journey.ids.length);for(const id of journey.ids)expect(GUIDES.some(g=>g.id===id)).toBe(true);}
  });
  it("no aprueba cantidades inválidas, campos vacíos ni el archivo que excede el límite",()=>{
    const quantity=GUIDES.find(g=>g.id==="presupuesto")!.steps[1];
    for(const values of [["","500000"],["NaN","500000"],["Infinity","500000"],["-1","500000"],["12","500000"]])expect(validatePractice(quantity,values)).not.toBeNull();
    expect(validatePractice(GUIDES.find(g=>g.id==="control-scanner")!.steps[1],["PDF de 21 MiB"])).not.toBeNull();
  });
});
describe("progreso local de aprendizaje",()=>{
  it("tolera datos rotos y descarta identificadores y pasos ajenos",()=>{
    expect(readLearningProgress("not-json").done).toEqual({});
    expect(readLearningProgress("x".repeat(100001)).done).toEqual({});
    const p=readLearningProgress(JSON.stringify({done:{activar:[0,0,-1,3,"1",1.2,1],unknown:[0]},last:{id:"unknown",step:0},password:"never-store"}));
    expect(p.done.activar).toEqual([0,1]);expect(p.done.unknown).toBeUndefined();expect(p.last).toBeUndefined();expect(JSON.stringify(p)).not.toContain("never-store");
  });
  it("completar un paso no completa una práctica entera ni otra práctica",()=>{
    let p=readLearningProgress("");p=markLearningStep(p,"activar",0);
    expect(isGuideComplete(p,"activar")).toBe(false);expect(isGuideComplete(p,"crear-proyecto")).toBe(false);
    p=markLearningStep(markLearningStep(p,"activar",1),"activar",2);
    expect(isGuideComplete(p,"activar")).toBe(true);expect(isGuideComplete(p,"unknown")).toBe(false);
    expect(markLearningStep(p,"activar",99)).toBe(p);
    expect(markLearningStep(p,"unknown",0)).toBe(p);
  });
  it("separa cuenta y empresa y persiste únicamente IDs y pasos",()=>{
    expect(progressStorageKey("empresa-a","u1")).not.toBe(progressStorageKey("empresa-b","u1"));
    expect(progressStorageKey("empresa-a","u1")).not.toBe(progressStorageKey("empresa-a","u2"));
    const p=markLearningStep(readLearningProgress(""),"presupuesto",1);
    expect(readLearningProgress(JSON.stringify(p))).toEqual(p);
    expect(Object.keys(p).sort()).toEqual(["done","last"]);
  });
});
