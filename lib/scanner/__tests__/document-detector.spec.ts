import { describe, expect, it } from "vitest";
import {
  detectDocumentFromRgba,
  isConvexQuad,
  orderQuadCorners,
  orderQuadPoints,
  polygonArea,
  createFallbackQuad,
} from "../document-detector";
import { Point2D } from "../types";

// Helper para crear un buffer RGBA inicializado con color base
function createRgbaBuffer(width: number, height: number, r = 30, g = 30, b = 30): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
  return buf;
}

// Helper para dibujar un cuadrilátero relleno en el buffer RGBA
function fillPolygon(
  buf: Uint8ClampedArray,
  w: number,
  h: number,
  pts: Point2D[],
  r: number,
  g: number,
  b: number
) {
  // Bounding box
  const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))));
  const maxX = Math.min(w - 1, Math.ceil(Math.max(...pts.map((p) => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))));
  const maxY = Math.min(h - 1, Math.ceil(Math.max(...pts.map((p) => p.y))));

  function isInside(x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x;
      const yi = pts[i].y;
      const xj = pts[j].x;
      const yj = pts[j].y;
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isInside(x, y)) {
        const idx = (y * w + x) * 4;
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
      }
    }
  }
}

describe("Document Detector & Computer Vision Pipeline", () => {
  describe("Geometría de Cuadriláteros (Convexidad, Orden y Área)", () => {
    it("calcula área de un rectángulo estándar con fórmula de Shoelace", () => {
      const rect: Point2D[] = [
        { x: 10, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 60 },
        { x: 10, y: 60 },
      ];
      expect(polygonArea(rect)).toBe(5000);
    });

    it("identifica cuadrilátero convexo válido", () => {
      const validQuad: Point2D[] = [
        { x: 50, y: 50 },
        { x: 450, y: 80 },
        { x: 420, y: 600 },
        { x: 80, y: 570 },
      ];
      expect(isConvexQuad(validQuad)).toBe(true);
    });

    it("rechaza polígono cóncavo (hendidura hacia adentro)", () => {
      const concave: Point2D[] = [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 300 },
      ];
      expect(isConvexQuad(concave)).toBe(false);
    });

    it("rechaza polígono con líneas auto-intersectadas (reloj de arena)", () => {
      const crossed: Point2D[] = [
        { x: 50, y: 50 },
        { x: 400, y: 400 },
        { x: 400, y: 50 },
        { x: 50, y: 400 },
      ];
      expect(isConvexQuad(crossed)).toBe(false);
    });

    it("rechaza puntos colineales", () => {
      const collinear: Point2D[] = [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
        { x: 250, y: 50 },
        { x: 50, y: 200 },
      ];
      expect(isConvexQuad(collinear)).toBe(false);
    });

    it("ordena canónicamente puntos [TL, TR, BR, BL]", () => {
      const shuffled: Point2D[] = [
        { x: 350, y: 450 },
        { x: 50, y: 50 },
        { x: 60, y: 440 },
        { x: 360, y: 60 },
      ];

      const ordered = orderQuadPoints(shuffled);
      expect(ordered.topLeft.x).toBe(50);
      expect(ordered.topLeft.y).toBe(50);
      expect(ordered.topRight.x).toBe(360);
      expect(ordered.topRight.y).toBe(60);
      expect(ordered.bottomRight.x).toBe(350);
      expect(ordered.bottomRight.y).toBe(450);
      expect(ordered.bottomLeft.x).toBe(60);
      expect(ordered.bottomLeft.y).toBe(440);
    });
  });

  describe("10 Fixtures Realistas de Detección con Ground Truth", () => {
    const W = 320;
    const H = 240;

    // Caso 1: Hoja blanca sobre fondo oscuro
    it("Caso 1: Hoja blanca sobre fondo oscuro", () => {
      const buf = createRgbaBuffer(W, H, 25, 25, 25);
      const gt = [
        { x: 50, y: 30 },
        { x: 270, y: 30 },
        { x: 270, y: 210 },
        { x: 50, y: 210 },
      ];
      fillPolygon(buf, W, H, gt, 245, 245, 245);

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      expect(res.confidence).toBeGreaterThanOrEqual(0.65);
      expect(res.quad.topLeft.x).toBeGreaterThanOrEqual(40);
      expect(res.quad.topLeft.x).toBeLessThanOrEqual(65);
      expect(res.quad.bottomRight.x).toBeGreaterThanOrEqual(255);
      expect(res.quad.bottomRight.x).toBeLessThanOrEqual(285);
    });

    // Caso 2: Hoja sobre fondo claro (madera clara / beige vs papel blanco)
    it("Caso 2: Hoja sobre fondo claro", () => {
      const buf = createRgbaBuffer(W, H, 175, 160, 140); // Beige/madera clara
      const gt = [
        { x: 60, y: 40 },
        { x: 260, y: 40 },
        { x: 260, y: 200 },
        { x: 60, y: 200 },
      ];
      fillPolygon(buf, W, H, gt, 250, 250, 250); // Blanco puro

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      expect(res.confidence).toBeGreaterThanOrEqual(0.5);
      expect(res.quad.topLeft.x).toBeGreaterThanOrEqual(45);
      expect(res.quad.topLeft.x).toBeLessThanOrEqual(75);
    });

    // Caso 3: Documento inclinado (rotado)
    it("Caso 3: Documento inclinado / rotado", () => {
      const buf = createRgbaBuffer(W, H, 30, 30, 30);
      const gt = [
        { x: 80, y: 50 },
        { x: 260, y: 30 },
        { x: 280, y: 190 },
        { x: 100, y: 210 },
      ];
      fillPolygon(buf, W, H, gt, 240, 240, 240);

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      expect(res.confidence).toBeGreaterThanOrEqual(0.65);
      expect(res.quad.topLeft.y).toBeLessThan(res.quad.bottomLeft.y);
      expect(res.quad.topRight.x).toBeGreaterThan(res.quad.topLeft.x);
    });

    // Caso 4: Trapezoide / perspectiva 3D
    it("Caso 4: Trapezoide con perspectiva marcada", () => {
      const buf = createRgbaBuffer(W, H, 20, 20, 20);
      // Arriba más angosto que abajo
      const gt = [
        { x: 90, y: 30 },
        { x: 230, y: 30 },
        { x: 280, y: 210 },
        { x: 40, y: 210 },
      ];
      fillPolygon(buf, W, H, gt, 240, 240, 240);

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      expect(res.confidence).toBeGreaterThanOrEqual(0.65);
      // Base inferior más ancha que superior
      const topWidth = res.quad.topRight.x - res.quad.topLeft.x;
      const bottomWidth = res.quad.bottomRight.x - res.quad.bottomLeft.x;
      expect(bottomWidth).toBeGreaterThan(topWidth);
    });

    // Caso 5: Sombra parcial diagonal
    it("Caso 5: Sombra parcial proyectada sobre el documento", () => {
      const buf = createRgbaBuffer(W, H, 30, 30, 30);
      const gt = [
        { x: 50, y: 30 },
        { x: 270, y: 30 },
        { x: 270, y: 210 },
        { x: 50, y: 210 },
      ];
      fillPolygon(buf, W, H, gt, 240, 240, 240);

      // Aplicar sombra en la mitad inferior (oscurecer a 140)
      for (let y = 140; y < 210; y++) {
        for (let x = 50; x < 270; x++) {
          const idx = (y * W + x) * 4;
          buf[idx] = 140;
          buf[idx + 1] = 140;
          buf[idx + 2] = 140;
        }
      }

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      expect(res.confidence).toBeGreaterThanOrEqual(0.5);
      expect(res.quad.topLeft.x).toBeGreaterThanOrEqual(40);
      expect(res.quad.topLeft.x).toBeLessThanOrEqual(70);
    });

    // Caso 6: Iluminación desigual (degradé de luz vertical)
    it("Caso 6: Iluminación con gradiente de luz", () => {
      const buf = createRgbaBuffer(W, H, 20, 20, 20);
      for (let y = 30; y < 210; y++) {
        const factor = 1 - (y - 30) / 250; // De brillante a tenue
        const lum = Math.round(240 * factor);
        for (let x = 50; x < 270; x++) {
          const idx = (y * W + x) * 4;
          buf[idx] = lum;
          buf[idx + 1] = lum;
          buf[idx + 2] = lum;
        }
      }

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      expect(res.confidence).toBeGreaterThanOrEqual(0.5);
    });

    // Caso 7: Objetos alrededor (lapicera / taza cerca del borde)
    it("Caso 7: Objetos externos y clutter alrededor del papel", () => {
      const buf = createRgbaBuffer(W, H, 25, 25, 25);
      const doc = [
        { x: 60, y: 30 },
        { x: 260, y: 30 },
        { x: 260, y: 200 },
        { x: 60, y: 200 },
      ];
      fillPolygon(buf, W, H, doc, 240, 240, 240);

      // Objeto oscuro cerca del papel (x: 10..35, y: 80..140)
      for (let y = 80; y < 140; y++) {
        for (let x = 10; x < 35; x++) {
          const idx = (y * W + x) * 4;
          buf[idx] = 180;
          buf[idx + 1] = 50;
          buf[idx + 2] = 50;
        }
      }

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      // Debe detectar la hoja principal, no el objeto pequeño
      expect(res.quad.topLeft.x).toBeGreaterThanOrEqual(45);
      expect(res.quad.topLeft.x).toBeLessThanOrEqual(75);
    });

    // Caso 8: Papel parcialmente fuera del frame (borde cortado)
    it("Caso 8: Papel que toca el borde del frame", () => {
      const buf = createRgbaBuffer(W, H, 20, 20, 20);
      const doc = [
        { x: 0, y: 20 },
        { x: 240, y: 20 },
        { x: 240, y: 220 },
        { x: 0, y: 220 },
      ];
      fillPolygon(buf, W, H, doc, 240, 240, 240);

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.quad.topLeft.x).toBeLessThanOrEqual(25);
      expect(res.quad.bottomLeft.x).toBeLessThanOrEqual(25);
    });

    // Caso 9: Dos documentos en el frame (debe priorizar el de mayor área)
    it("Caso 9: Dos documentos presentes en el frame", () => {
      const buf = createRgbaBuffer(W, H, 20, 20, 20);
      // Documento pequeño (tarjeta)
      fillPolygon(buf, W, H, [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 60 },
        { x: 20, y: 60 },
      ], 220, 220, 220);

      // Documento principal grande (hoja A4)
      const mainDoc = [
        { x: 100, y: 20 },
        { x: 300, y: 20 },
        { x: 300, y: 220 },
        { x: 100, y: 220 },
      ];
      fillPolygon(buf, W, H, mainDoc, 250, 250, 250);

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(false);
      // Debe detectar el documento grande
      expect(res.quad.topLeft.x).toBeGreaterThanOrEqual(80);
      expect(res.quad.bottomRight.x).toBeGreaterThanOrEqual(275);
    });

    // Caso 10: Imagen sin documento (fondo uniforme)
    it("Caso 10: Imagen uniforme sin documento -> activa fallback inteligente", () => {
      const buf = createRgbaBuffer(W, H, 100, 100, 100);

      const res = detectDocumentFromRgba(buf, W, H);
      expect(res.isFallback).toBe(true);
      expect(res.confidence).toBeLessThan(0.5);

      const fallback = createFallbackQuad(W, H);
      expect(res.quad.topLeft.x).toBeCloseTo(fallback.topLeft.x, 1);
      expect(res.quad.bottomRight.x).toBeCloseTo(fallback.bottomRight.x, 1);
    });
  });
});
