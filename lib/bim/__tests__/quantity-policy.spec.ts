import { describe, expect, it } from "vitest";
import { selectCanonicalQuantity, type RawQuantityCandidate } from "../quantity-policy";

function candidate(overrides: Partial<RawQuantityCandidate>): RawQuantityCandidate {
  return { kind: "area", value: 0, name: "", psetName: "Qto_WallBaseQuantities", ...overrides };
}

describe("selectCanonicalQuantity — política de cantidad canónica (double counting)", () => {
  it("prefiere Net sobre Gross para la misma pared (no las suma)", () => {
    const candidates = [
      candidate({ name: "GrossSideArea", value: 51.2 }),
      candidate({ name: "NetSideArea", value: 46.7 }),
    ];
    const result = selectCanonicalQuantity(candidates, ["area", "volume", "length"]);
    expect(result).toEqual({ kind: "area", value: 46.7, property: "Qto_WallBaseQuantities.NetSideArea", ambiguous: false });
  });

  it("usa Gross si Net no está disponible", () => {
    const candidates = [candidate({ name: "GrossSideArea", value: 51.2 })];
    const result = selectCanonicalQuantity(candidates, ["area"]);
    expect(result).toEqual({ kind: "area", value: 51.2, property: "Qto_WallBaseQuantities.GrossSideArea", ambiguous: false });
  });

  it("falla cerrado (ambiguous) ante dos NetSideArea con valores distintos en Quantity Sets distintos", () => {
    const candidates = [
      candidate({ name: "NetSideArea", value: 46.7, psetName: "Qto_WallBaseQuantities" }),
      candidate({ name: "NetSideArea", value: 44.1, psetName: "Qto_Custom" }),
    ];
    const result = selectCanonicalQuantity(candidates, ["area"]);
    expect(result?.ambiguous).toBe(true);
  });

  it("NO es ambiguo si dos candidatos del mismo tier tienen exactamente el mismo valor (dato duplicado, no conflictivo)", () => {
    const candidates = [
      candidate({ name: "NetSideArea", value: 46.7, psetName: "Qto_WallBaseQuantities" }),
      candidate({ name: "NetSideArea", value: 46.7, psetName: "Qto_Duplicated" }),
    ];
    const result = selectCanonicalQuantity(candidates, ["area"]);
    expect(result?.ambiguous).toBe(false);
    if (!result?.ambiguous) expect(result?.value).toBe(46.7);
  });

  it("pasa al siguiente kind preferido si el actual no tiene candidatos", () => {
    const candidates = [candidate({ kind: "volume", name: "NetVolume", value: 6.9, psetName: "Qto_WallBaseQuantities" })];
    const result = selectCanonicalQuantity(candidates, ["area", "volume", "length"]);
    expect(result?.ambiguous).toBe(false);
    if (!result?.ambiguous) expect(result?.kind).toBe("volume");
  });

  it("devuelve null si no hay ningún candidato de los kinds preferidos", () => {
    const result = selectCanonicalQuantity([], ["area", "volume"]);
    expect(result).toBeNull();
  });

  it("distingue GrossVolume de NetVolume igual que con área (no mezcla volúmenes)", () => {
    const candidates = [
      candidate({ kind: "volume", name: "GrossVolume", value: 20 }),
      candidate({ kind: "volume", name: "NetVolume", value: 17.5 }),
    ];
    const result = selectCanonicalQuantity(candidates, ["volume"]);
    expect(result?.ambiguous).toBe(false);
    if (!result?.ambiguous) expect(result?.value).toBe(17.5);
  });
});
