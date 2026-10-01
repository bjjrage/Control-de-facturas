import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentOrchestrator } from "../orchestrator";

const originalFetch = globalThis.fetch;

function response(content: string) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

function dbNoOp() {
  return {
    from: vi.fn(),
    rpc: vi.fn(),
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("Rodrigo knowledge integration", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("inyecta contexto relevante en el system prompt para datos operativos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response("Necesito el identificador del producto para leer el stock."));
    globalThis.fetch = fetchMock;
    const orchestrator = new AgentOrchestrator({ apiKey: "test-key" });

    await orchestrator.run({
      db: dbNoOp(),
      actor: { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "test" },
      userIntent: "¿Tenemos stock de cemento?",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    const systemMessages = body.messages.filter((message) => message.role === "system").map((message) => message.content ?? "");
    expect(systemMessages.some((content) => content.includes("Inventario, stock y depósitos"))).toBe(true);
  });

  it("no inyecta el manual para un saludo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response("¡Hola! ¿Qué necesitás?"));
    globalThis.fetch = fetchMock;
    const orchestrator = new AgentOrchestrator({ apiKey: "test-key" });

    await orchestrator.run({
      db: dbNoOp(),
      actor: { empresaId: "empresa-1", userId: "user-1", role: "admin", actorType: "user", source: "test" },
      userIntent: "Hola Rodrigo",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { messages: Array<{ role: string; content?: string }> };
    const systemContent = body.messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n");
    expect(systemContent).not.toContain("Contexto interno de conocimiento estático");
  });
});
