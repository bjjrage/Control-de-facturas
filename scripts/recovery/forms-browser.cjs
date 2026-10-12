// Component regression harness. Server actions are synthetic; this is NOT ERP E2E.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const { chromium, firefox } = require('@playwright/test');

const source = path.resolve(process.argv[2] || '.');
const output = path.resolve(process.argv[3] || 'recovery-evidence/browser');
fs.mkdirSync(output, { recursive: true });
const itemId = '10000000-0000-4000-8000-000000000001';
const versionId = '20000000-0000-4000-8000-000000000001';
const isRecovery = fs.existsSync(path.join(source,'lib/rfq/document-analysis.ts'));
const offers = [{id:itemId,rfq_item_id:itemId,quote_version_id:versionId,provider_id:itemId,provider_name:'Ferreteria sintetica',version_number:1,precio_unitario:16000,currency:'PYG',tax_rate:10,available_quantity:5,lead_time_days:2,freight:0,payment_terms:'Contado',valid_until:'2099-01-01T23:59:59Z',vat_included:false,attachment_id:itemId,review_id:null,revoked:false}];
const stub = `
export const useRouter = () => ({push:url=>window.lastPush=url, refresh:()=>window.refreshes=(window.refreshes||0)+1});
export default function Link(p) {return <a {...p}/>}
export const createClient=()=>({from:()=>({select(){return this},eq(){return this},order:async()=>({data:[]})})});
export const createRfq=async fd=>{window.calls=(window.calls||0)+1;window.lastData=Object.fromEntries(fd);return window.createResult||{error:'Fallo sintético',id:null}};
export const uploadRfqAttachments=async()=>({error:null});
export const listProjectsForCostRfqAction=async()=>({data:[{id:'obra-1',name:'Obra de prueba',code:'TEST'}]});
export const createCostRfqsFromProject=async()=>({data:{creadas:[],rubrosSinProveedores:[],sinInsumos:true}});
export const submitMultiItemQuote=async fd=>({error:'Fallo sintético'});
export const submitInternalQuoteAction=submitMultiItemQuote;
export const addReceipt=async()=>({error:'Fallo sintético'});
export const previewDirectPurchaseAction=async()=>({error:'Fallo sintético',data:null});
export const confirmDirectPurchaseAction=previewDirectPurchaseAction;
export const extractQuoteDocumentAction=async()=>{window.manualExtractions=(window.manualExtractions||0)+1;return {error:'Unexpected manual extraction',data:null}};
export const openQuoteAttachmentAction=async()=>({error:null,data:null});
export const authorizeAllocationAction=async()=>({error:'Synthetic',data:null});
export const confirmOrdersAction=authorizeAllocationAction;
export const previewOrdersAction=authorizeAllocationAction;
export const reviewQuoteAction=authorizeAllocationAction;
export const saveAllocationAction=authorizeAllocationAction;
export const setProjectCostPriceAction=authorizeAllocationAction;
`;
async function bundle() {
  const entry = `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {RfqDialog} from ${JSON.stringify(path.join(source,'app/(internal)/rfqs/rfq-dialog.tsx'))};
import {MultiItemQuoteForm} from ${JSON.stringify(path.join(source,'app/cotizar/[token]/multi-item-quote-form.tsx'))};
import {SalesForm} from ${JSON.stringify(path.join(source,'app/(internal)/ventas/sales-form.tsx'))};
import {ReceiptDialog} from ${JSON.stringify(path.join(source,'app/(internal)/ventas/[id]/receipt-dialog.tsx'))};
import {OrderDialog} from ${JSON.stringify(path.join(source,'app/(internal)/orders/order-dialog.tsx'))};
import {RfqWorkspace} from ${JSON.stringify(path.join(source,'app/(internal)/rfqs/[id]/rfq-workspace.tsx'))};
const mode=new URLSearchParams(location.search).get('mode');
const items=[{id:${JSON.stringify(itemId)},descripcion:'Cemento',cantidad:5,unidad:'bolsa'}];
async function render() {
const analysis=mode==='analysis'?await fetch('/analysis').then(r=>r.json()):null;
createRoot(document.getElementById('root')).render(mode==='analysis'?<RfqWorkspace rfqId="rfq" purpose="PROCUREMENT" projectId={null} items={items} offers={${JSON.stringify(offers)}} analyses={analysis} allocations={[]} canAdopt={false}/>:mode==='receipt'?<ReceiptDialog docId="documento" saldo={100} currency="PYG" trigger={<button>Abrir cobro</button>}/>:mode==='direct'?<OrderDialog defaultOpen providers={[{id:'proveedor-1',name:'Proveedor de prueba'}]} initialItems={[{product:'Cemento',quantity:5,unit:'bolsa',producto_id:''}]}/>:mode==='quote'?<MultiItemQuoteForm token={'a'.repeat(64)} items={items}/>:mode==='sales'?<SalesForm clients={[{id:'cliente-1',name:'Cliente de prueba'}]} action={async()=>({error:'Fallo sintético'})}/>:<RfqDialog projectId={mode==='project'?'obra-1':undefined} defaultOpen trigger={<button>Abrir RFQ</button>}/>);
} render();
`;
  const result = await esbuild.build({stdin:{contents:entry,resolveDir:source,loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture',setup(build){
    build.onResolve({filter:/.*/}, args=>{
      if (['next/navigation','next/link','@/lib/supabase/browser'].includes(args.path) || /(?:rfqs|cotizar).*\/(?:actions|workflow-actions)$/.test(args.path) || args.path.endsWith('/costeo-actions') || ['../projects/[id]/costeo-actions','./actions','../actions','./direct-purchase-actions','./workflow-actions'].includes(args.path)) return {path:'stub',namespace:'fixture'};
      if(args.path.startsWith('@/')) {
        const file=path.join(source,args.path.slice(2));
        return {path:['','.tsx','.ts','.js','/index.tsx','/index.ts'].map(ext=>file+ext).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile())||file};
      }
    });
    build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:stub,loader:'tsx',resolveDir:source}));
  }}]});
  return result.outputFiles[0].text;
}
async function main() {
  const js = await bundle();
  let analyze;
  if(isRecovery) {
    require('tsx/cjs');
    analyze=require(path.join(source,'lib/rfq/document-analysis.ts')).analyzeRfqDocuments;
  }
  const server = http.createServer(async(req,res)=>{
    if(req.url==='/analysis') {
      try {
        const XLSX=require('xlsx');const book=XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet([{'Descripción':'Cemento','Precio unitario':'15000','Moneda':'PYG'}]),'Presupuesto');
        const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
        const db={from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{id:itemId,bucket:'quote-pdfs',path:'synthetic.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}})}),storage:{from:()=>({download:async()=>({data:new Blob([bytes]),error:null})})}};
        const analyses=await analyze(db,itemId,[{id:itemId,descripcion:'Cemento',cantidad:5,unidad:'bolsa',producto_id:null}],offers);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(analyses));
      } catch(e) {res.end(JSON.stringify({error:e.message,data:null}))}
      return;
    }
    res.setHeader('Content-Type', req.url==='/app.js'?'application/javascript':'text/html');res.end(req.url==='/app.js'?js:'<html><head><style>body{font:14px Arial;background:#101c2c;color:white}input,textarea,button{margin:4px;padding:5px}input{max-width:180px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}dialog,[role=dialog]{background:#18283c;padding:20px}table{max-width:100%}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const results=[];
  try {
    for (const [name,engine] of [['chromium',chromium],['firefox',firefox]]) {
      const browser=await engine.launch({headless:true});
      try {
        for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
          const page=await browser.newPage({viewport});
          // Prevent any third-party request, including accidental app calls.
          await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
          const errors=[];page.on('pageerror',e=>errors.push(e.message));
          for (const mode of ['rfq','project','quote','sales','receipt','direct',...(isRecovery?['analysis']:[])]) {
            await page.goto(url+'/?mode='+mode);
            if(mode==='rfq'||mode==='project') {
              await page.getByRole('combobox',{name:/Propósito|Para qué/}).click();
              await page.getByRole('option',{name:/Comprar|Compra de materiales/}).click();
              await page.getByLabel('Descripción 1',{exact:true}).fill('Cemento');
              await page.getByLabel('Cantidad 1',{exact:true}).fill('5');
              await page.getByLabel('Unidad 1',{exact:true}).fill('bolsa');
              await page.locator('[name=specifications]').fill('Conservar esta especificación');
              await page.getByRole('button',{name:/Confirmar creación de RFQ|Crear RFQ/}).click();
              await page.getByRole('alert').filter({hasText:'Fallo sintético'}).waitFor();
              results.push({browser:name,viewport,mode,kept:(await page.locator('[name=specifications]').inputValue())==='Conservar esta especificación',project:await page.evaluate(()=>window.lastData.project_id??null)});
              if(isRecovery) {
                await page.evaluate(()=>{window.createResult={error:null,id:'rfq-created'}});
                await page.getByRole('button',{name:'Crear RFQ',exact:true}).click();
                await page.waitForFunction(()=>window.lastPush==='/rfqs/rfq-created');
                await page.getByRole('button',{name:'Abrir RFQ',exact:true}).click();
                const clean=(await page.getByLabel('Descripción 1',{exact:true}).inputValue())==='';
                results.push({browser:name,viewport,mode:'reopen-'+mode,kept:clean});
              }
            } else if(mode==='quote') {
              for(const [field,value] of Object.entries({['price_'+itemId]:'15000',['available_'+itemId]:'5',['tax_'+itemId]:'10',['lead_'+itemId]:'2',budget_number:'PP-123',valid_until:'2099-01-01',freight:'0',payment_terms:'Contado'})) await page.locator('[name="'+field+'"]').fill(value);
              await page.getByRole('combobox').click();await page.getByRole('option',{name:'PYG',exact:true}).click();
              await page.locator('[name=attachment]').setInputFiles({name:'presupuesto.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture')});
              await page.getByRole('button',{name:/Enviar nueva versión|Confirmar y enviar/}).click();
              await page.getByRole('alert').waitFor();
              results.push({browser:name,viewport,mode,kept:(await page.locator('[name=budget_number]').inputValue())==='PP-123',fileKept:await page.locator('[name=attachment]').evaluate(e=>e.files.length===1)});
            } else if(mode==='receipt') {
              await page.getByRole('button',{name:'Abrir cobro',exact:true}).click();
              await page.locator('[name=reference]').fill('TRANSFERENCIA-123');
              await page.getByRole('button',{name:'Registrar',exact:true}).click();
              await page.getByText('Fallo sintético',{exact:true}).waitFor();
              results.push({browser:name,viewport,mode,kept:(await page.locator('[name=reference]').inputValue())==='TRANSFERENCIA-123'});
            } else if(mode==='direct') {
              await page.getByRole('combobox',{name:'Proveedor',exact:true}).click();await page.getByRole('option',{name:'Proveedor de prueba',exact:true}).click();
              await page.locator('[name=payment_terms]').fill('Contado contra entrega');
              await page.locator('[name=freight]').fill('0');
              await page.getByLabel(/Impuesto %/).fill('10');
              await page.locator('tbody input[type=number]').nth(1).fill('15000');
              await page.locator('form').evaluate(e=>e.requestSubmit());
              await page.getByText('Fallo sintético',{exact:true}).waitFor();
              results.push({browser:name,viewport,mode,kept:(await page.locator('[name=payment_terms]').inputValue())==='Contado contra entrega',providerKept:(await page.locator('[name=provider_id]').inputValue())==='proveedor-1'});
            } else if(mode==='analysis') {
              await page.locator('summary').filter({hasText:'Reconciliación'}).click();
              // The real reader prepared these inputs; the test never fills them.
              results.push({browser:name,viewport,mode:'automatic-xlsx-comparison',
                kept:(await page.getByLabel('Precio documento',{exact:true}).inputValue())==='15000',
                unknownTax:(await page.getByLabel('Impuesto documento %',{exact:true}).inputValue())==='',
                compared:await page.getByText(/oferta 16000 \/ documento 15000/).count()===1,
                automatic:await page.evaluate(()=>(window.manualExtractions||0)===0),
                humanRequired:await page.getByRole('button',{name:'Registrar revisión humana'}).isDisabled(),
                proposed:await page.getByRole('button',{name:'Usar como propuesta editable'}).count()>0});
            } else {
              await page.getByRole('combobox').first().click();await page.getByRole('option',{name:'Cliente de prueba'}).click();
              await page.locator('input[required]').filter({visible:true}).last().fill('Trabajo de prueba');
              await page.locator('[name=notes]').fill('Conservar condiciones');
              await page.locator('form').evaluate(e=>e.requestSubmit());
              await page.getByText('Fallo sintético',{exact:true}).waitFor();
              results.push({browser:name,viewport,mode,kept:(await page.locator('[name=notes]').inputValue())==='Conservar condiciones',clientKept:(await page.locator('[name=client_id]').inputValue())==='cliente-1'});
            }
            await page.screenshot({path:path.join(output,`${name}-${viewport.width}-${mode}.png`),fullPage:true});
          }
          if(errors.length) throw new Error(errors.join('\n'));
          await page.close();
        }
      } finally {await browser.close()}
    }
  } finally {await new Promise(resolve=>server.close(resolve))}
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({kind:'COMPONENT_FIXTURE_NOT_E2E',source,results},null,2));
  console.log(JSON.stringify(results,null,2));
  if(process.argv.includes('--expect-pass')&&results.some(r=>!r.kept||r.fileKept===false||r.clientKept===false||r.providerKept===false||r.unknownTax===false||r.compared===false||r.automatic===false||r.humanRequired===false||r.proposed===false)) throw new Error('Component regression failed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
