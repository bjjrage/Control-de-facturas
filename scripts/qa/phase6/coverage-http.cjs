// HTTP smoke is NOT visual/keyboard E2E. Preserve that distinction in every row.
const {session,request,save,fs,path,root}=require('./context.cjs');
(async()=>{
 const s=await session();const inventory=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/2026-10-17-inventario-cobertura.json'),'utf8'));
 const records=inventory.cases.map(c=>({...c,sourceExists:fs.existsSync(path.join(root,c.file)),runtime:'NOT_TESTED',visual:'NOT_TESTED',keyboard:'NOT_TESTED',role:'admin QA only',note:c.kind==='action'?'Source inventory entry; no runtime PASS inferred from containing page':'Requires current screenshot and interaction evidence'}));
 const tables={};for(const route of ['/clientes','/invoices','/ordenes-trabajo','/orders','/pagos','/providers','/rfqs','/stock','/ventas']){
  const r=await request(s,route);const html=await r.text();tables[route]=[...new Set([...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1]).filter(h=>h.startsWith(route+'/')&&/[0-9a-f]{8}-/.test(h)))];
 }
 const project='86b8a8d7-0b15-4e30-b623-c1d3cfe260f8';
 for(const c of records.filter(c=>c.kind==='surface')){
  if(!c.file.endsWith('/page.tsx')){c.note='API/export surface: requires its specific method/fixture; no browser screen assumed';continue}
  let route=c.file.replace(/^app\/\(internal\)|^app\/\(print\)/,'').replace(/\/page\.tsx$/,'');
  if(route.includes('[token]')){c.note='Public portal requires a valid current scoped token; no invalid-token PASS';continue}
  if(route.includes('[id]')){
   if(route.includes('/projects/')){c.note='Nested project context requires matching project/order/RFQ fixture';continue}
   const prefix=route.split('/[id]')[0];const link=tables[prefix]?.[0];if(!link){c.note='No matching current QA record link found';continue}
   route=route.replace(prefix+'/[id]',link);
  }
  const r=await request(s,route);const html=await r.text();
  c.http={route,status:r.status,redirect:r.url.includes('/login'),h1:html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g,'').slice(0,160),hasErrorDigest:/"digest":"\d+"/.test(html)};
  c.runtime=r.status===200&&!c.http.redirect&&!c.http.hasErrorDigest?'HTTP_ONLY':'HTTP_REVIEW';
  console.log(c.id,c.runtime,r.status,route);
 }
 save('u1-inventory-http',{scope:'50 surface entries +129 action entries, not 179 screens. HTTP_ONLY is not visual/keyboard/role approval.',records});
})().catch(e=>{console.error(e);process.exitCode=1});
