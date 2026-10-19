// Bounded QA role fixture, isolated branch only. Always restore the prior flag.
const {db,must,assert,fs,path,root}=require('./context.cjs');
const out=path.join(root,'audit-evidence/c06-u1-2026-10-19');
const marker=path.join(out,'u1-superadmin-release.private');
(async()=>{
 const id='6037b09a-c8b4-4aa5-9c3a-f655330bf430';
 const before=must(await db.from('profiles').select('id,email,empresa_id,is_super_admin').eq('id',id).single());
 assert.equal(before.email,'recovery-admin@example.test');
 assert.equal(before.empresa_id,'f775a9e6-30a6-4156-98f7-bfed0e8d87da');
 if(fs.existsSync(marker))fs.unlinkSync(marker);
 try{
  must(await db.from('profiles').update({is_super_admin:true}).eq('id',id).eq('email',before.email).select('id').single());
  console.log('QA superadmin visual window ready; automatic restoration within 3 minutes');
  const deadline=Date.now()+180000;
  while(Date.now()<deadline&&!fs.existsSync(marker))await new Promise(r=>setTimeout(r,500));
 }finally{
  must(await db.from('profiles').update({is_super_admin:before.is_super_admin}).eq('id',id).eq('email',before.email).select('id').single());
  const after=must(await db.from('profiles').select('is_super_admin').eq('id',id).single());
  assert.equal(after.is_super_admin,before.is_super_admin);
  fs.writeFileSync(path.join(out,'u1-role-restored.json'),JSON.stringify({ref:'kyiihlkncatojvlasoag',qaUser:id,originalFlag:before.is_super_admin,restoredFlag:after.is_super_admin,restored:true},null,2));
  console.log('QA profile original flag restored and verified');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
