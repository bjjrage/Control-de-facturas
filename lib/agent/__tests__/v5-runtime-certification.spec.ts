import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../orchestrator";
import "@/lib/tools";

const runRuntime = process.env.RUN_RODRIGO_V5_RUNTIME === "1";

type QueryResult = { data: unknown; error: null };

function emptyDb() {
  return {
    from(table: string) {
      const builder: Record<string, (...args: unknown[]) => unknown> = {};
      const result = (): QueryResult => {
        if (table === "agent_approvals") return { data: { id: "approval-runtime", payload_hash: "runtime-hash" }, error: null };
        if (table === "agent_steps") return { data: { id: "step-runtime" }, error: null };
        return { data: [], error: null };
      };
      for (const method of ["select", "insert", "update", "delete", "eq", "neq", "in", "or", "contains", "order", "limit", "is", "gt", "lt"]) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.single = async () => result();
      builder.then = (...args: any[]) => Promise.resolve(result()).then(args[0], args[1]);
      return builder;
    },
    rpc: async () => ({ data: null, error: null }),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

const actor = { empresaId: "runtime-fixture", userId: "runtime-user", role: "admin" as const, actorType: "user" as const, source: "test" as const };

describe.runIf(runRuntime)("Rodrigo V5 runtime certification with real DeepSeek", () => {
  it("runs greeting and preserves natural response without deterministic routing", async () => {
    expect(process.env.DEEPSEEK_API_KEY).toBeTruthy();
    const result = await new AgentOrchestrator({ maxIterations: 4, timeoutMs: 90_000, toolAllowlist: [] }).run({
      db: emptyDb(),
      actor,
      userIntent: "Hola Rodrigo",
    });
    expect(result.stoppedReason).toBe("answered");
    expect(result.answer.trim().length).toBeGreaterThan(0);
    expect(result.observability?.toolsRequested).toEqual([]);
  }, 120_000);

  it("uses real knowledge, history, entity resolution and emergent tool composition", async () => {
    const result = await new AgentOrchestrator({ maxIterations: 6, timeoutMs: 90_000 }).run({
      db: emptyDb(),
      actor,
      userIntent: "No respondas sólo con una explicación general: consultá el conocimiento del ERP y resolvé la obra humana 'Algarrobos' para analizar qué podés leer de una factura de proveedor y de una orden de trabajo. No inventes datos si la fixture no tiene coincidencias.",
      conversationHistory: [
        { role: "user", content: "Estamos revisando operaciones del ERP." },
        { role: "assistant", content: "Puedo consultar datos vivos cuando existe una herramienta segura." },
      ],
    });
    expect(["answered", "max_iterations", "approval_required"]).toContain(result.stoppedReason);
    expect(result.observability?.knowledgeSections.length).toBeGreaterThan(0);
    expect(result.observability?.userIntentPreview).toContain("factura");
    expect(result.observability?.toolsRequested.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(result.observability?.toolsExecuted).toBeDefined();
    expect(result.answer.trim().length).toBeGreaterThan(0);
  }, 180_000);
});
