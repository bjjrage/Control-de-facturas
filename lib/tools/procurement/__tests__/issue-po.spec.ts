import {describe,it,expect,vi} from "vitest";
import {IssuePurchaseOrderInputSchema} from "../issue-purchase-order";
import {issuePurchaseOrderDomainService} from "@/lib/procurement/issue-po-service";
import {toolRegistry} from "@/lib/agent/registry";
describe('RFQ 2 forbids agent order issuance shortcuts',()=>{
 it('keeps sensitive tool protected by risk 3',()=>expect(toolRegistry.get('issue_purchase_order')?.riskLevel).toBe(3));
 it('requires explicit confirmation in legacy input',()=>expect(IssuePurchaseOrderInputSchema.safeParse({po_draft_id:'10000000-0000-4000-8000-000000000001',confirm_issuance:false}).success).toBe(false));
 it.each([false,true])('agent cannot issue even with confirm=%s',async confirm=>{
  const db={rpc:vi.fn(),from:vi.fn()};await expect(issuePurchaseOrderDomainService({db:db as any,empresaId:'tenant',userId:'user',poDraftId:'legacy',confirmIssuance:confirm})).rejects.toThrow(/humano/);
  expect(db.rpc).not.toHaveBeenCalled();expect(db.from).not.toHaveBeenCalled();
 });
});
