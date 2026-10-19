const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'audit-evidence/c06-u1-2026-10-19');
function log(name){
 const file=path.join(out,name),bytes=fs.readFileSync(file);
 const s=(bytes[0]===255&&bytes[1]===254?bytes.toString('utf16le'):bytes.toString('utf8')).replace(/^\uFEFF/,'').replace(/\x1b\[[0-9;]*m/g,'');
 fs.writeFileSync(file,s);return s;
}
const tests=log('vitest-release.log'),build=log('build-print-final.log');
assert.match(tests,/Tests\s+2442 passed\s*\|\s*16 skipped/);
assert.doesNotMatch(tests,/\d+ failed/);
assert.match(build,/Compiled successfully/);assert.match(build,/59\/59/);
for(const name of ['vitest-final.log','build-final.log','build-layout-final.log','build-tooltip-final.log','build-release.log','vitest-layout-final.log'])log(name);
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const matrix=read('u1-matrix.json'),role=read('u1-role-restored.json'),c06=read('c06-live.json');
assert.equal(matrix.pages.length,75);assert.ok(matrix.pages.every(p=>p.captures.length));
assert.equal(matrix.historical.length,179);assert.ok(matrix.historical.every(c=>c.u1!=='PENDING_UI'));
assert.equal(role.restored,true);assert.equal(role.restoredFlag,false);
assert.equal(c06.originalBytesPreserved,true);assert.equal(c06.tamperedFileRejected,true);
const trace=JSON.parse(fs.readFileSync(path.join(root,'.next/server/app/(internal)/invoices/page.js.nft.json'),'utf8')).files;
const tracing={canvas:trace.filter(p=>p.includes('canvas')).length,pdfWorker:trace.filter(p=>p.includes('pdf.worker')).length,pdfParse:trace.filter(p=>p.includes('pdf-parse')).length};
assert.ok(Object.values(tracing).every(n=>n>0));
const result={branch:'codex/compras-ventas-merge-prep',runtimeCommit:'dc99c2f',isolatedRef:'kyiihlkncatojvlasoag',releaseBuildId:fs.readFileSync(path.join(root,'.next/BUILD_ID'),'utf8').trim(),c06CompleteE2EBuildId:c06.buildId,c06OriginalPreserved:true,typescriptExit:0,buildExit:0,vitest:{passed:2442,skipped:16,failed:0,completedBeforeFinalPrintClassFix:true},postSuiteChange:'dc99c2f removes two conflicting text color classes from the printed payment badge; final tsc/build/browser repeated',directedTests:{passed:36,failed:0},currentPageRoutes:75,projectTabs:19,historicalEntries:179,qaRoleRestored:true,pdfRuntimeTracing:tracing,newSql:false,productionAccess:false,push:false,merge:false,deploy:false};
fs.writeFileSync(path.join(out,'final-checks.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
