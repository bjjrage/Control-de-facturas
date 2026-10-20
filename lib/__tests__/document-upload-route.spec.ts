import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { uploadPrincipal } from "@/lib/document-upload-ticket";
import { MAX_DOCUMENT_BYTES } from "@/lib/document-upload";
const state=vi.hoisted(()=>({ allowed:true, public:false, limit:20971520, signed:0, pending:0, expired:false, removed:[] as string[] }));
vi.mock("@/lib/document-upload-authorization",()=>({ authorizeDocumentUpload:async()=>{ if(!state.allowed)throw Error("revoked"); return uploadPrincipal("internal","tenant:user"); } }));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({storage:{
  getBucket:async()=>({data:{public:state.public,file_size_limit:state.limit},error:null}),
  from:()=>({list:async()=>({data:Array.from({length:state.pending},()=>state.expired ? ({id:"object",name:"11111111-1111-4111-8111-111111111111",created_at:new Date(Date.now()-4*3600000).toISOString(),updated_at:new Date(Date.now()-4*3600000).toISOString()}) : ({})),error:null}),
    createSignedUploadUrl:async()=>{state.signed++;return{data:{token:"test-upload-token"},error:null}},remove:async(paths:string[])=>{state.removed.push(...paths);return{error:null}}}),
}})}));
import { POST, DELETE } from "@/app/api/document-uploads/route";
const metadata={name:"invoice.pdf",type:"application/pdf",size:MAX_DOCUMENT_BYTES,sha256:"a".repeat(64)};
const context={kind:"internal"};
function request(input:unknown,origin="http://localhost:3018",method="POST") { return new NextRequest("http://localhost:3018/api/document-uploads",{method,headers:{origin,"content-type":"application/json"},body:JSON.stringify(input)}); }
beforeEach(()=>{vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test-only-secret");state.allowed=true;state.public=false;state.limit=MAX_DOCUMENT_BYTES;state.signed=0;state.pending=0;state.expired=false;state.removed=[];});
it("issues a bounded, principal-bound reference for exactly 20 MiB",async()=>{
  const response=await POST(request({context,file:metadata}));expect(response.status).toBe(200);
  const data=await response.json();expect(data.reference).toMatch(/^direct-upload:v1:/);expect(data.path).toMatch(/^[a-f0-9]{64}\/[a-f0-9-]{36}$/);
  expect(data.token).toBe("test-upload-token");expect(JSON.stringify(data).length).toBeLessThan(2000);
});
it.each([0,MAX_DOCUMENT_BYTES+1])("rejects %i bytes before minting a signed URL",async size=>{
  expect((await POST(request({context,file:{...metadata,size}}))).status).toBe(400);expect(state.signed).toBe(0);
});
it("rejects revoked credentials, cross-origin and oversized control requests",async()=>{
  state.allowed=false;expect((await POST(request({context,file:metadata}))).status).toBe(400);
  state.allowed=true;expect((await POST(request({context,file:metadata},"https://attacker.test"))).status).toBe(400);
  expect((await POST(request({context,file:metadata,padding:"x".repeat(9000)}))).status).toBe(400);expect(state.signed).toBe(0);
});
it("fails closed on a public or incorrectly bounded bucket",async()=>{
  state.public=true;expect((await POST(request({context,file:metadata}))).status).toBe(503);
  state.public=false;state.limit=MAX_DOCUMENT_BYTES+1;expect((await POST(request({context,file:metadata}))).status).toBe(503);expect(state.signed).toBe(0);
});
it("limits pending objects and rejects arbitrary cleanup paths",async()=>{
  state.pending=24;expect((await POST(request({context,file:metadata}))).status).toBe(429);
  expect((await DELETE(request({context,reference:"invoice-files/another-tenant.pdf"},undefined,"DELETE"))).status).toBe(400);
});

it("reclaims expired temporary objects only under the authorized principal",async()=>{
  state.pending=24;state.expired=true;const response=await POST(request({context,file:metadata}));expect(response.status).toBe(200);
  const owner=uploadPrincipal("internal","tenant:user");expect(state.removed).toHaveLength(24);
  expect(state.removed.every(path=>path===owner+"/11111111-1111-4111-8111-111111111111")).toBe(true);
});
