import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { issueDocumentTicket, uploadPrincipal, verifyDocumentTicket } from "@/lib/document-upload-ticket";
import { MAX_DOCUMENT_BYTES, validDocumentMetadata } from "@/lib/document-upload";

const state = vi.hoisted(() => ({ bytes: new TextEncoder().encode("%PDF-1.4\nqa"), size: 11, removed: [] as string[], removeError: false }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ storage: { from: (bucket: string) => {
  expect(bucket).toBe("direct-document-uploads");
  return {
    info: async () => ({ data: { size: state.size }, error: null }),
    download: async () => ({ data: new Blob([state.bytes]), error: null }),
    remove: async (paths: string[]) => { state.removed.push(...paths); return { error: state.removeError ? { message: "fail" } : null }; },
  };
} } }) }));
import { materializeDocument, materializeDocumentForm } from "@/lib/document-upload-server";
const principal = uploadPrincipal("internal", "empresa:actor");
function metadata(bytes: Uint8Array = state.bytes) { return { name: "factura.pdf", type: "application/pdf", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; }
beforeEach(() => { vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-secret"); state.bytes = new TextEncoder().encode("%PDF-1.4\nqa"); state.size=11; state.removed=[]; state.removeError=false; });
it("accepts exactly 20 MiB and rejects zero and 20 MiB + 1", () => {
  const m=metadata(); expect(validDocumentMetadata({...m,size:MAX_DOCUMENT_BYTES})).toBe(true);
  for(const size of [0,-1,MAX_DOCUMENT_BYTES+1,1.5,NaN]) expect(validDocumentMetadata({...m,size})).toBe(false);
});
it("binds tenant, actor and scope, and rejects tampering and expiry", () => {
  const issued=issueDocumentTicket(principal,metadata());
  expect(verifyDocumentTicket(issued.reference,principal).path).toBe(issued.ticket.path);
  for(const owner of [uploadPrincipal("internal","other:actor"),uploadPrincipal("internal","empresa:other"),uploadPrincipal("receipt","empresa:actor")]) expect(()=>verifyDocumentTicket(issued.reference,owner)).toThrow();
  expect(()=>verifyDocumentTicket(issued.reference+"x",principal)).toThrow();
  expect(()=>verifyDocumentTicket(issued.reference+".",principal)).toThrow();
  expect(()=>verifyDocumentTicket(issued.reference,principal,issued.ticket.expires)).toThrow();
  expect(()=>verifyDocumentTicket("invoice-files/other.pdf",principal)).toThrow();
});
it("downloads only its signed path and consumes the temporary object",async()=>{
  const issued=issueDocumentTicket(principal,metadata());const file=await materializeDocument(issued.reference,principal);
  expect(file.name).toBe("factura.pdf");expect(file.type).toBe("application/pdf");expect(file.size).toBe(11);
  expect(state.removed).toEqual([issued.ticket.path]);
});
it("rejects changed bytes even with identical length and deletes the invalid temporary object",async()=>{
  const issued=issueDocumentTicket(principal,metadata());state.bytes=new Uint8Array(11).fill(4);
  await expect(materializeDocument(issued.reference,principal)).rejects.toThrow(/contenido/);expect(state.removed).toEqual([issued.ticket.path]);
});
it("checks Storage size before downloading and fails closed on cleanup failure",async()=>{
  const issued=issueDocumentTicket(principal,metadata());state.size=MAX_DOCUMENT_BYTES+1;
  await expect(materializeDocument(issued.reference,principal)).rejects.toThrow(/tamaño/);expect(state.removed).toEqual([]);
  state.size=11;state.removeError=true;await expect(materializeDocument(issued.reference,principal)).rejects.toThrow(/finalizar/);
});
it("preserves repeated form fields while replacing references with files",async()=>{
  const form=new FormData();form.append("items","a");form.append("items","b");form.set("file",issueDocumentTicket(principal,metadata()).reference);
  const hydrated=await materializeDocumentForm(form,principal);expect(hydrated.getAll("items")).toEqual(["a","b"]);expect(hydrated.get("file")).toBeInstanceOf(File);
});
it("rejects an oversized aggregate before any download",async()=>{
  const form=new FormData();for(let i=0;i<3;i++)form.append("files",issueDocumentTicket(principal,{...metadata(),size:MAX_DOCUMENT_BYTES}).reference);
  await expect(materializeDocumentForm(form,principal)).rejects.toThrow(/50 MiB/);expect(state.removed).toEqual([]);
});
