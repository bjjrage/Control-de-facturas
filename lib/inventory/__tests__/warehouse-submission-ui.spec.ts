import { describe, expect, it } from "vitest";
import { displayLocationName } from "../display-location-name";
import { canConfirmWarehouseSubmission } from "../warehouse-submission-ui";

describe("displayLocationName", () => {
  it("relabels legacy singular and plural pañol names without changing surrounding text", () => {
    expect(displayLocationName("Pañol central")).toBe("Depósito central");
    expect(displayLocationName("PAÑOLES de obra")).toBe("Depósitos de obra");
    expect(displayLocationName("Depósito - Panol auxiliar")).toBe("Depósito - Depósito auxiliar");
  });

  it("does not replace pañol as part of another word", () => {
    expect(displayLocationName("Pañolero")).toBe("Pañolero");
  });
});

describe("canConfirmWarehouseSubmission", () => {
  const base = { status: "READY" as const, uploadIncomplete: false };

  it("requires at least one accepted line", () => {
    expect(canConfirmWarehouseSubmission({ ...base, lineStates: [] })).toBe(false);
    expect(canConfirmWarehouseSubmission({ ...base, lineStates: ["REJECTED"] })).toBe(false);
  });

  it("allows accepted lines with rejected partial lines but no proposals", () => {
    expect(canConfirmWarehouseSubmission({ ...base, lineStates: ["CONFIRMED", "REJECTED"] })).toBe(true);
  });

  it("blocks proposals, incomplete uploads and non-confirmable statuses", () => {
    expect(canConfirmWarehouseSubmission({ ...base, lineStates: ["CONFIRMED", "PROPOSED"] })).toBe(false);
    expect(canConfirmWarehouseSubmission({ ...base, uploadIncomplete: true, lineStates: ["CONFIRMED"] })).toBe(false);
    expect(canConfirmWarehouseSubmission({ ...base, status: "PROCESSING", lineStates: ["CONFIRMED"] })).toBe(false);
  });
});
