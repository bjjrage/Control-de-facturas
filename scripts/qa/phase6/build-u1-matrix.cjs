// Coverage accounting only. A source entry or HTTP 200 is never a UI PASS.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'audit-evidence/c06-u1-2026-10-19');
const records=JSON.parse(fs.readFileSync(path.join(out,'u1-records-private.json'),'utf8'));
const privateContext=JSON.parse(fs.readFileSync(path.join(out,'u1-private-context.json'),'utf8'));
const portalPaths=Object.values(privateContext).filter(v=>typeof v==='string'&&v.startsWith('/'));
const sanitize=value=>typeof value==='string'?portalPaths.reduce((s,p)=>s.replaceAll(p,p.replace(/\/[^/]+$/,'/[token]')),value):value;
const latest=[...new Map(records.map(r=>[r.route,r])).values()].map(r=>{
 const safe=Object.fromEntries(Object.entries(r).map(([k,v])=>[k,sanitize(v)]));
 const file=path.join(out,safe.capture);if(!fs.existsSync(file))throw new Error('Missing capture: '+safe.capture);
 const png=fs.readFileSync(file);safe.viewport={width:png.readUInt32BE(16),height:png.readUInt32BE(20)};
 safe.review=safe.route==='/empresas'&&safe.stage!=='VISUAL_REVIEW_QA_SUPERADMIN'?'ROLE_GUARD_ONLY':safe.actualRoute&&safe.actualRoute!==safe.route.split('?')[0]?'REDIRECT_OR_ALIAS':'VISUAL_REVIEWED';
 return safe;
});
function routeOf(file){return file.replaceAll('\\','/').replace(/^app/,'').replace(/\/\([^/]+\)/g,'').replace(/\/(?:page\.tsx|route\.ts)$/,'')||'/';}
function matches(pattern,route){
 const parts=pattern.split('/').map(p=>/^\[(?:id|roomId|orderId|rfqId)\]$/.test(p)?'[0-9a-f]{8}-[0-9a-f-]{27,}':p.startsWith('[')?'[^/]+':p.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&'));
 return new RegExp('^'+parts.join('/')+'$').test(route.split('?')[0]);
}
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name==='page.tsx'?[path.relative(root,path.join(dir,e.name)).replaceAll('\\','/')]:[]);}
const pages=walk(path.join(root,'app')).map(file=>({file,route:routeOf(file),captures:latest.filter(r=>matches(routeOf(file),r.route))}));
const inventory=JSON.parse(fs.readFileSync(path.join(root,'docs/audits/2026-10-17-inventario-cobertura.json'),'utf8')).cases;
const historical=inventory.map(c=>({...c,sourceExists:fs.existsSync(path.join(root,c.file)),u1:c.kind==='action'?'SERVER_ACTION_NOT_A_SCREEN':c.file.endsWith('/route.ts')?'API_OR_EXPORT_NOT_A_SCREEN':latest.some(r=>matches(routeOf(c.file),r.route))?'VISUAL_CAPTURED':'PENDING_UI'}));
const result={scope:'179 historical entries = 129 server actions + 50 surfaces; current page inventory is accounted separately. Captures alone do not certify keyboard or destructive behavior.',historical,pages,records:latest};
fs.writeFileSync(path.join(out,'u1-matrix.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({historical:{total:historical.length,pending:historical.filter(c=>c.u1==='PENDING_UI').map(c=>({id:c.id,file:c.file}))},currentPages:{total:pages.length,pending:pages.filter(p=>!p.captures.length).map(p=>p.route)},captures:latest.length},null,2));
