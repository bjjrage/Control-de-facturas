import { describe, expect, it } from "vitest";
import { routeChatIntent } from "../rodrigo-chat";

describe("Rodrigo email deterministic route", () => {
  it("routes explicit email requests to prepare_email without sending", () => {
    const result = routeChatIntent("mandale un mail a fatima@example.com asunto Nueva propuesta decile que adjuntamos la propuesta");
    expect(result).toMatchObject({ kind: "tool", tool: "prepare_email" });
    if (result.kind === "tool") {
      expect(result.input).toMatchObject({ to: ["fatima@example.com"], subject: "Nueva propuesta" });
      expect(result.input).not.toHaveProperty("draft_id");
    }
  });

  it("edits the active draft instead of routing a new send", () => {
    const result = routeChatIntent("hacelo más corto", undefined, "00000000-0000-4000-a000-000000000001");
    expect(result).toEqual({
      kind: "tool",
      tool: "prepare_email",
      input: {
        draft_id: "00000000-0000-4000-a000-000000000001",
        objective: "hacelo más corto",
        revision_instruction: "hacelo más corto",
      },
    });
  });
});
