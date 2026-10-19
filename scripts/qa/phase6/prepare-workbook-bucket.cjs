const {db,must,assert,save}=require('./context.cjs');
(async()=>{
 assert.ok(process.argv.includes('--create-isolated-bucket'),'Explicit isolated test setup flag required');
 let buckets=must(await db.storage.listBuckets());const existing=buckets.find(b=>b.id==='certificate-workbooks');
 if(!existing)must(await db.storage.createBucket('certificate-workbooks',{public:false,fileSizeLimit:10*1024*1024,allowedMimeTypes:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']}));
 const bucket=must(await db.storage.getBucket('certificate-workbooks'));assert.equal(bucket.public,false);
 save('workbook-bucket-setup',{ref:'kyiihlkncatojvlasoag',created:!existing,bucket,policies:'Existing baseline session/project policies; no grants or policies modified'});console.log('Isolated private workbook bucket ready; existing policies unchanged.');
})().catch(e=>{console.error(e);process.exitCode=1});
