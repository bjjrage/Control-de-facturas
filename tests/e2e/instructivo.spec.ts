import {test,expect,type Page} from "@playwright/test";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {existsSync,readFileSync} from "node:fs";
import {GUIDES,JOURNEYS} from "../../lib/instructivo/content";
import {assertNonProductionTestTarget} from "../../test-utils/external-test-target";

// Match exact build action IDs and source files, never blanket-allow POSTs or action names.
// These existing shell loaders only read lists; any other non-GET request fails the exercise audit.
const warmLoaders=new Map([
  ["app/(internal)/dashboard/section-action.ts","getDashboardData"],
  ["app/(internal)/invoices/section-action.ts","getInvoicesData"],
  ["app/(internal)/orders/section-action.ts","getOrdersData"],
  ["app/(internal)/pagos/section-action.ts","getPagosData"],
  ["app/(internal)/providers/section-action.ts","getProvidersData"],
  ["app/(internal)/rfqs/section-action.ts","getRfqsData"],
  ["app/(internal)/clientes/section-action.ts","getClientesData"],
  ["app/(internal)/cobros/section-action.ts","getCobrosData"],
  ["app/(internal)/ventas/_components/sales-list-section-action.ts","getSalesListData"]
]);
const manifestPath=resolve(".next/server/server-reference-manifest.json");
const actions:Record<string,{filename?:string;exportedName?:string}>=existsSync(manifestPath)?JSON.parse(readFileSync(manifestPath,"utf8")).node??{}:{};
const readActionIds=new Map(Object.entries(actions).filter(([,a])=>a.filename&&warmLoaders.get(a.filename)===a.exportedName).map(([id,a])=>[id,a.exportedName!]));

test.beforeEach(async({page,baseURL})=>{
  if(!baseURL||!process.env.NEXT_PUBLIC_SUPABASE_URL)throw new Error("Explicit local/QA targets required");
  assertNonProductionTestTarget({url:baseURL,label:"Instructivo browser"});
  assertNonProductionTestTarget({url:process.env.NEXT_PUBLIC_SUPABASE_URL,label:"Instructivo database"});
  test.skip(!process.env.E2E_EMAIL_A||!process.env.E2E_PASSWORD,"Requiere usuario de QA; nunca se crean datos de negocio.");
  await page.goto("/login");
  await page.getByLabel("Email",{exact:true}).fill(process.env.E2E_EMAIL_A!);
  await page.getByLabel("Contraseña",{exact:true}).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button",{name:"Ingresar",exact:true}).click();
  await expect(page).toHaveURL(/\/dashboard/, {timeout:45_000});
  await page.getByRole("link",{name:"Instructivo",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Aprendé haciendo.",exact:true})).toBeVisible({timeout:45_000});
  // Wait for initial page requests; existing shell background loaders are audited separately below.
  await page.waitForLoadState("networkidle");
});

async function completeCurrent(page:Page,id:string) {
  const guide=GUIDES.find(g=>g.id===id)!;
  for(let i=0;i<guide.steps.length;i++) {
    await expect(page.getByLabel("Instrucciones de la práctica")).toContainText(`Paso ${i+1} de ${guide.steps.length}`);
    const example=page.getByRole("button",{name:"Usar datos de ejemplo",exact:true});
    if(await example.count())await example.click();
    const action=page.getByTestId("practice-action");
    if(await action.isEnabled())await action.click();
    await expect(page.getByTestId("practice-result")).toContainText(guide.steps[i].result);
    await page.getByTestId("practice-next").click();
  }
  await expect(page.getByTestId("practice-complete")).toBeVisible();
}

test("todas las prácticas se completan y persisten sin escrituras de negocio",async({page,baseURL},info)=>{
  test.setTimeout(180_000);
  const errors:string[]=[],writes:string[]=[],shellReads:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  const recordRequest=(r:import("@playwright/test").Request)=>{
    if(["GET","HEAD","OPTIONS"].includes(r.method()))return;
    const url=new URL(r.url()),read=readActionIds.get(r.headers()["next-action"]??"");
    if(r.method()==="POST"&&url.origin===new URL(baseURL!).origin&&url.pathname==="/instructivo"&&read)shellReads.push(read);
    else writes.push(r.method()+" "+url.pathname);
  };
  page.on("request",recordRequest);
  await page.screenshot({path:info.outputPath("biblioteca.png"),fullPage:true});
  for(const guide of GUIDES) {
    await page.locator(`[data-guide="${guide.id}"]`).click();
    await completeCurrent(page,guide.id);
    await page.getByRole("button",{name:"Elegir otra práctica",exact:true}).click();
  }
  page.off("request",recordRequest);
  await page.reload();
  await expect(page.getByTestId("interactive-guide")).toContainText(`${GUIDES.length} de ${GUIDES.length} prácticas completadas`);
  const saved=await page.evaluate(()=>Object.entries(localStorage).filter(([k])=>k.startsWith("control-facturas.instructivo.v1:")));
  expect(saved).toHaveLength(1);
  const progress=JSON.parse(saved[0][1]);expect(Object.keys(progress).sort()).toEqual(["done","last"]);
  expect(JSON.stringify(progress)).not.toContain("500000");
  expect(writes).toEqual([]);expect(errors).toEqual([]);
  await info.attach("practices-verification",{body:JSON.stringify({practices:GUIDES.length,steps:GUIDES.reduce((n,g)=>n+g.steps.length,0),writes,errors,shellReads}),contentType:"application/json"});
});

test("validación, filtros, enlaces profundos y recorrido completo",async({page})=>{
  test.setTimeout(90_000);
  await page.getByLabel("Buscar una tarea",{exact:true}).fill("tarea inexistente xyz");
  await expect(page.locator("[data-guide]")).toHaveCount(0);
  await page.getByRole("button",{name:"Quitar filtros",exact:true}).click();
  await page.getByLabel("Buscar una tarea",{exact:true}).fill("scanner");
  await expect(page.locator("[data-guide]")).toHaveCount(2);
  await page.getByLabel("Buscar una tarea",{exact:true}).fill("");
  await page.getByLabel("Filtrar por rol",{exact:true}).selectOption("Comercial");
  await expect(page.locator('[data-guide="personal"]')).toHaveCount(0);
  await page.getByLabel("Filtrar por rol",{exact:true}).selectOption("");
  await page.locator('[data-guide="presupuesto"]').click();
  await page.getByRole("button",{name:/Mapear cantidades y precios/}).click();
  await page.getByLabel("Cantidad",{exact:true}).fill("11");await page.getByLabel("Precio unitario PYG",{exact:true}).fill("500000");
  await page.getByTestId("practice-action").click();await expect(page.getByLabel("Pantalla de práctica").getByRole("alert")).toContainText("10");await expect(page.getByTestId("practice-next")).toBeDisabled();
  await page.getByRole("button",{name:"Usar datos de ejemplo",exact:true}).click();await page.getByTestId("practice-action").click();await expect(page.getByTestId("practice-next")).toBeEnabled();
  await page.getByRole("button",{name:"Biblioteca",exact:true}).click();
  await page.getByRole("button",{name:"Empezar mi primera obra",exact:false}).click();
  for(const [i,id] of JOURNEYS[0].ids.entries()) {
    await completeCurrent(page,id);
    const next=GUIDES.find(g=>g.id===JOURNEYS[0].ids[i+1]);
    if(next)await page.getByRole("button",{name:`Seguir: ${next.title}`,exact:false}).click();
  }
  await page.goto("/instructivo#guia/control-scanner/NaN");await expect(page.getByTestId("practice-action")).toHaveText("Vincular móvil de ejemplo");
});

test("móvil, teclado y reinicio limitado a una práctica",async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  const collapse=page.getByRole("button",{name:"Colapsar menú",exact:true});if(await collapse.count())await collapse.click();
  await page.locator('[data-guide="activar"]').focus();await page.keyboard.press("Enter");
  await expect(page.getByTestId("practice-action")).toBeVisible();
  await page.getByRole("button",{name:"Usar datos de ejemplo",exact:true}).click();await page.getByTestId("practice-action").click();
  await page.getByRole("button",{name:"Repetir práctica",exact:true}).click();await page.getByRole("button",{name:"Reiniciar esta práctica",exact:true}).click();
  await expect(page.getByTestId("practice-next")).toBeDisabled();
  const bounds=await page.getByTestId("interactive-guide").evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right}));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.client+1);expect(bounds.right).toBeLessThanOrEqual(391);
  await page.screenshot({path:info.outputPath("practica-mobile.png"),fullPage:false});
  await page.getByTestId("practice-next").scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath("practica-mobile-instrucciones.png"),fullPage:false});
  await completeCurrent(page,"activar");
});

test("documentos HTML conservan interactividad sin errores JS",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(resolve("instructivos y roadmap/manual-de-obra.html")).href);
  await expect(page.locator("#plan-semanal")).toHaveCount(1);await expect(page.locator("#lab-cpp")).toHaveCount(1);
  await page.locator("#cpp-qty").fill("70");await page.locator("#cpp-qty").dispatchEvent("input");await expect(page.locator("#cpp-result")).not.toBeEmpty();
  await page.goto(pathToFileURL(resolve("instructivos y roadmap/flujo-de-obra.html")).href);
  await expect(page.locator("#flow .step").first()).toBeVisible();
  const order=await page.locator("#flow .step").evaluateAll(es=>es.map(e=>e.getAttribute("data-id")));
  expect(order.indexOf("plansemanal")).toBeLessThan(order.indexOf("cotizar"));expect(order).toContain("costeo");expect(errors).toEqual([]);
});

test("el progreso funciona sin almacenamiento y la ruta exige sesión",async({page,browser,baseURL})=>{
  await page.addInitScript(()=>{
    const original=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key.startsWith("control-facturas.instructivo.v1:"))throw new DOMException("Storage blocked","SecurityError");
      return original.call(this,key,value);
    };
  });
  await page.reload();
  await page.locator('[data-guide="activar"]').click();
  await completeCurrent(page,"activar");
  await page.getByRole("button",{name:"Elegir otra práctica",exact:true}).click();
  await expect(page.getByTestId("interactive-guide")).toContainText("1 de 34 prácticas completadas");
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("control-facturas.instructivo.v1:")))).toEqual([]);
  const anonymous=await browser.newContext();
  try {
    const guest=await anonymous.newPage();
    await guest.goto(`${baseURL}/instructivo`);
    await expect(guest).toHaveURL(/\/login/);
  } finally {await anonymous.close();}
});
