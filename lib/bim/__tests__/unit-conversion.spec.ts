import { describe, expect, it } from "vitest";
import { scaleForKind, type ProjectUnitScales } from "../unit-conversion";

const scales: ProjectUnitScales = {
  lengthToMetres: 0.001,
  areaToSquareMetres: 1,
  volumeToCubicMetres: 1,
};

describe("scaleForKind — weight (MASSUNIT) falla cerrado, nunca asume kg en silencio", () => {
  it("length/area/volume usan la escala leída del proyecto", () => {
    expect(scaleForKind("length", scales)).toBe(0.001);
    expect(scaleForKind("area", scales)).toBe(1);
    expect(scaleForKind("volume", scales)).toBe(1);
  });

  it("count es adimensional, siempre escala 1", () => {
    expect(scaleForKind("count", scales)).toBe(1);
  });

  it("weight devuelve null SIEMPRE — no implementado, no se asume kg (bug real corregido: antes devolvía 1 por defecto)", () => {
    expect(scaleForKind("weight", scales)).toBeNull();
    // Ni siquiera si el proyecto no declaró ninguna escala en absoluto:
    // "no sabemos" y "no implementado" deben dar el mismo resultado (null).
    expect(scaleForKind("weight", { lengthToMetres: null, areaToSquareMetres: null, volumeToCubicMetres: null })).toBeNull();
  });
});
