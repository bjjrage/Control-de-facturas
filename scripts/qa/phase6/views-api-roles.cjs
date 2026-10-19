const{env,session,save,assert}=require('./context.cjs');
const{createClient}=require('@supabase/supabase-js');
(async()=>{
 const s=await session(),anon=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}}),result=[];
 for(const view of ['v_procurement_competitor_contextual','v_procurement_competitor_global']){
  const a=await anon.from(view).select('*').order('supplier_id'),b=await s.auth.from(view).select('*').order('supplier_id');
  assert.equal(a.error,null);assert.equal(b.error,null);assert.deepEqual(a.data,b.data);
  result.push({view,anonymousRows:a.data.length,authenticatedRows:b.data.length,equal:true,columns:Object.keys(a.data[0]||{}),scope:'Public national procurement data; SQL dependency evidence is required in addition to row equality.'});
 }
 save('views-api-roles',result);console.log(result);
})().catch(e=>{console.error(e);process.exitCode=1});
