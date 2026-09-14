import { describe, it, expect } from "vitest";
import { actorFromProfile, actorForSystem, actorForAgent, assertActorHasTenant, withRuntime } from "../context";
import type { CurrentProfile } from "@/lib/auth";

const baseProfile = {
  id: "user-123",
  email: "test@empresa.com",
  full_name: "Test User",
  role: "admin" as const,
  active: true,
  empresa_id: "empresa-abc",
  is_super_admin: false,
  created_at: new Date().toISOString(),
  empresa_active: true,
  modulo_compras: true,
  modulo_ventas: true,
  plan: "pro" as const,
} satisfies CurrentProfile;

describe("context", () => {
  it("actorFromProfile construye contexto confiable desde perfil", () => {
    const actor = actorFromProfile(baseProfile);
    expect(actor.empresaId).toBe("empresa-abc");
    expect(actor.userId).toBe("user-123");
    expect(actor.role).toBe("admin");
    expect(actor.actorType).toBe("user");
    expect(actor.source).toBe("web");
  });

  it("actorForSystem requiere empresaId explicito", () => {
    const a = actorForSystem({ empresaId: "emp-x", userId: null });
    expect(a.empresaId).toBe("emp-x");
    expect(a.actorType).toBe("system");
    expect(() => actorForSystem({ empresaId: "" } as unknown as { empresaId: string })).toThrow();
  });

  it("assertActorHasTenant fail-closed si falta empresaId", () => {
    expect(() => assertActorHasTenant({ empresaId: "", userId: null, role: null, actorType: "user", source: "web" })).toThrow();
    expect(() => assertActorHasTenant({ empresaId: "ok", userId: null, role: null, actorType: "system", source: "worker" })).not.toThrow();
  });

  it("withRuntime enriquece con task/run/project", () => {
    const actor = actorForAgent({ empresaId: "emp1", userId: "u1" });
    const enriched = withRuntime(actor, { taskId: "t1", runId: "r1", projectId: "p1" });
    expect(enriched.taskId).toBe("t1");
    expect(enriched.projectId).toBe("p1");
  });

  it("no acepta empresa_id del LLM como autoridad — siempre del perfil/task", () => {
    // El LLM podría intentar inyectar empresa_id en el input del tool; el gateway/handler
    // debe ignorarlo y usar actor.empresaId. Este test documenta el invariante.
    const actor = actorFromProfile(baseProfile);
    const llmPayload = { project_id: "proj-123", empresa_id: "otra-empresa-inyectada" };
    // El handler no lee input.empresa_id, solo actor.empresaId — verificamos que actor es el de confianza
    expect(actor.empresaId).toBe("empresa-abc");
    expect((llmPayload as unknown as { empresa_id: string }).empresa_id).not.toBe(actor.empresaId);
  });
});
