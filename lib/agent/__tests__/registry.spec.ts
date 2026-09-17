import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { toolRegistry, registerTool, getTool } from "../registry";
import type { AgentToolContext } from "../context";

describe("registry", () => {
  beforeEach(() => toolRegistry.clearForTests());

  it("registra y recupera tool", () => {
    const schema = z.object({ foo: z.string() });
    registerTool({
      name: "test_tool",
      description: "tool de test",
      inputSchema: schema,
      riskLevel: 0,
      handler: async (_ctx: AgentToolContext, _input: { foo: string }) => ({ ok: true }),
    });
    expect(toolRegistry.has("test_tool")).toBe(true);
    expect(getTool("test_tool")?.name).toBe("test_tool");
  });

  it("rechaza duplicado", () => {
    const s = z.object({});
    registerTool({ name: "dup", description: "x", inputSchema: s, riskLevel: 0, handler: async () => null });
    expect(() => registerTool({ name: "dup", description: "y", inputSchema: s, riskLevel: 0, handler: async () => null })).toThrow(/ya registrado/);
  });

  it("valida nombre snake_case", () => {
    const s = z.object({});
    expect(() => registerTool({ name: "BadName", description: "x", inputSchema: s, riskLevel: 0, handler: async () => null })).toThrow(/snake_case/);
  });

  it("riskLevel es data del registry, no del LLM", () => {
    const s = z.object({});
    registerTool({ name: "low", description: "x", inputSchema: s, riskLevel: 0, handler: async () => null });
    registerTool({ name: "high", description: "x", inputSchema: s, riskLevel: 3, handler: async () => null });
    expect(getTool("low")?.riskLevel).toBe(0);
    expect(getTool("high")?.riskLevel).toBe(3);
  });

  it("allowlist filtra correctamente", () => {
    const s = z.object({});
    registerTool({ name: "a", description: "a", inputSchema: s, riskLevel: 0, handler: async () => null });
    registerTool({ name: "b", description: "b", inputSchema: s, riskLevel: 0, handler: async () => null });
    expect(toolRegistry.listForAllowlist(["a"]).map((t) => t.name)).toEqual(["a"]);
    expect(toolRegistry.list().length).toBe(2);
  });
});
