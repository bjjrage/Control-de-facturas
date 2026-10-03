import { expect, it, vi } from "vitest";
import { executeWinningTenderHandoff, executeTenderToProjectTransaction } from "../tender-to-project";
const tender = "cccccccc-1111-4111-8111-111111111111";
it("requires explicit human confirmation", async () => {
  const db = { rpc: vi.fn() };
  expect((await executeWinningTenderHandoff(db, tender)).error).toBeTruthy();
  expect(db.rpc).not.toHaveBeenCalled();
});
it("sends only tender identity and confirmation, never caller commercial facts", async () => {
  const db = { rpc: vi.fn().mockResolvedValue({ data: { success: true, project_id: "project", project_code: "code", already_existed: true }, error: null }) };
  const r = await executeTenderToProjectTransaction(db, { tenderId: tender, confirmedHandoff: true, adjudicatedOfferPricePyg: 999999, bidItems: [] } as any);
  expect(db.rpc).toHaveBeenCalledWith("prebid_create_project", { p_tender_id: tender, p_confirm: true });
  expect(r).toEqual({ error: null, projectId: "project", projectCode: "code", alreadyExisted: true });
});
it("fails closed on DB rejection or malformed response", async () => {
  const db = { rpc: vi.fn().mockResolvedValueOnce({ error: { message: "No winner" } }).mockResolvedValueOnce({ data: { success: true }, error: null }) };
  expect((await executeWinningTenderHandoff(db, tender, true)).error).toBe("No winner");
  expect((await executeWinningTenderHandoff(db, tender, true)).error).toBeTruthy();
});
it("rejects invalid context before any RPC", async () => {
  const db = { rpc: vi.fn() };expect((await executeWinningTenderHandoff(db, "DNCP-1", true)).error).toBeTruthy();expect(db.rpc).not.toHaveBeenCalled();
});
