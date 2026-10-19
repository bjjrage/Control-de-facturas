// Load pure TS workbook utilities for creating a VALID mapping independently
// of the invalid values sent over HTTP. No server actions are imported here.
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../../..'),resolve=Module._resolveFilename;
Module._resolveFilename=function(name,parent,...rest){return resolve.call(this,name.startsWith('@/')?path.join(root,name.slice(2)):name,parent,...rest)};
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const XLSX=require('xlsx');
const {parseWorkbook}=require(path.join(root,'lib/workbook-interpretation/parser.ts'));
const {reconcileImportPlan}=require(path.join(root,'lib/workbook-interpretation/import-plan.ts'));
module.exports=function(){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
  ['CERTIFICADO Nro. 1 - QA Fase6'],['Periodo: desde 01/10/2026 hasta 19/10/2026'],
  ['COD','RUBRO','UND','CONTRACTUAL','ANTERIOR','PRESENTE','ACUMULADO','P.U.'],
  ['QA1','Unidad QA','un',10,0,1,1,10000]
 ]),'CERTIFICADO');
 const valid=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});const book=parseWorkbook(valid,'qa-certificate.xlsx');
 const inferred=reconcileImportPlan(book,{workbookType:'CONSTRUCTION_PROJECT',overallConfidence:1,blocks:[],unresolvedRegions:[],warnings:[]},['CERTIFICATE']);
 if(!inferred.plan.blocks.some(b=>b.target==='CERTIFICATE'))throw new Error('QA fixture has no valid certificate mapping');
 wb.Sheets.CERTIFICADO.F4={t:'s',v:'no-numero'};
 return{bytes:XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),plan:{...inferred.plan,warnings:[...inferred.plan.warnings,...inferred.warnings]}};
};
