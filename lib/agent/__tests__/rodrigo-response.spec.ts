import { describe, expect, it } from "vitest";
import { normalizeRodrigoResponse } from "@/lib/agent/rodrigo-response";

describe("normalizeRodrigoResponse", () => {
  it("shows the natural message from fenced legacy JSON", () => {
    expect(normalizeRodrigoResponse('```json\n{"mensaje":"¡Hola! ¿Qué necesitás?"}\n```')).toBe("¡Hola! ¿Qué necesitás?");
  });

  it("keeps regular prose untouched", () => {
    expect(normalizeRodrigoResponse("Claro. ¿A quién va?")).toBe("Claro. ¿A quién va?");
  });
});
