const{fs,path,out,assert}=require('./context.cjs');
for(const name of ['ledger-final.json','security-advisors-final.json','views-readonly.json','vitest-final.log','build-final.log']){
 const file=path.join(out,name),b=fs.readFileSync(file);let text;
 if(b[0]===255&&b[1]===254)text=b.toString('utf16le').replace(/^\uFEFF/,'');else text=b.toString('utf8').replace(/^\uFEFF/,'');
 // Normalize terminal padding/encoding only; retain outcomes and error text.
 fs.writeFileSync(file,text.replace(/[ \t]+$/gm,'').trimEnd()+'\n');
}
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name+'.json'),'utf8'));
for(const name of ['api-checks','climate-dncp'])assert.ok(read(name).every(x=>x.status==='PASS'),name+' contains unresolved failures');
assert.equal(read('manual-original').length,3);
assert.equal(read('real-storage-failure').bucketRestored,true);
assert.equal(read('receipt-uncertain').uncertain.status,503);
const ledger=read('ledger-final').rows[0].verification;assert.equal(ledger.ledger.length,11);assert.ok(ledger.ledger.every(x=>x.applied));
const coverage=read('u1-inventory-http');
console.log(JSON.stringify({build:read('final-build-meta'),apiChecks:read('api-checks').length,climateDncpChecks:read('climate-dncp').length,u1:{total:coverage.records.length,surfaces:coverage.records.filter(x=>x.kind==='surface').length,httpOnly:coverage.records.filter(x=>x.runtime==='HTTP_ONLY').length,httpReview:coverage.records.filter(x=>x.runtime==='HTTP_REVIEW').length},ledger:ledger.ledger.length},null,2));
