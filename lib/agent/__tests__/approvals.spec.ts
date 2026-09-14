import { describe, it, expect } from "vitest";
import { canonicalJsonStringify, hashPayload, assertPayloadMatchesApproval } from "../approvals";
import type { AgentApprovalRow } from "../approvals";

describe("approvals", () => {
  it("canonicalJsonStringify es deterministico independiente del orden", () => {
    const a = { b: 2, a: 1, c: { z: 3, y: 2 } };
    const b = { a: 1, c: { y: 2, z: 3 }, b: 2 };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
    expect(canonicalJsonStringify(a)).toBe('{"a":1,"b":2,"c":{"y":2,"z":3}}');
  });

  it("hashPayload es estable y detecta mutacion", () => {
    const payload = { project_id: "p1", quantity: 10 };
    const h1 = hashPayload(payload);
    const h2 = hashPayload({ quantity: 10, project_id: "p1" });
    expect(h1).toBe(h2);
    const h3 = hashPayload({ project_id: "p1", quantity: 11 });
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);
  });

  it("assertPayloadMatchesApproval pasa si hash coincide y esta APPROVED", () => {
    const payload = { tool: "prepare_po", amount: 1000 };
    const hash = hashPayload(payload);
    const approval = {
      id: "ap1",
      task_id: "t1",
      run_id: "r1",
      empresa_id: "emp1",
      tool_name: "prepare_po",
      payload_json: payload,
      payload_hash: hash,
      risk_level: 3,
      status: "APPROVED",
      requested_by: "u1",
      decided_by: "u1",
      decided_at: new Date().toISOString(),
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as AgentApprovalRow;
    expect(() => assertPayloadMatchesApproval(approval, payload)).not.toThrow();
  });

  it("detecta bug payload A aprobado -> ejecutar B", () => {
    const payloadA = { project_id: "p1", amount: 1000 };
    const payloadB = { project_id: "p1", amount: 9999 };
    const hashA = hashPayload(payloadA);
    const approval = {
      id: "ap1",
      task_id: "t1",
      run_id: "r1",
      empresa_id: "emp1",
      tool_name: "issue_po",
      payload_json: payloadA,
      payload_hash: hashA,
      risk_level: 3,
      status: "APPROVED",
      requested_by: "u1",
      decided_by: "u1",
      decided_at: new Date().toISOString(),
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as AgentApprovalRow;
    expect(() => assertPayloadMatchesApproval(approval, payloadB)).toThrow(/alterado/);
  });

  it("rechaza si approval no esta APPROVED", () => {
    const payload = { x: 1 };
    const hash = hashPayload(payload);
    const approval = {
      id: "ap1",
      task_id: "t1",
      run_id: "r1",
      empresa_id: "emp1",
      tool_name: "x",
      payload_json: payload,
      payload_hash: hash,
      risk_level: 2,
      status: "REQUESTED",
      requested_by: "u1",
      decided_by: null,
      decided_at: null,
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as AgentApprovalRow;
    expect(() => assertPayloadMatchesApproval(approval, payload)).toThrow(/no esta APPROVED/);
  });
});
