import { describe, expect, it } from 'vitest';
import {
  applyScanFilter,
  detectDefaultCorners,
  getHomographyMatrix,
  pointDistance,
  warpPerspective,
} from '../image-processing';

describe('Image Processing & Perspective Correction', () => {
  it('calcula distancia euclidiana entre dos puntos correctamente', () => {
    const p1 = { x: 0, y: 0 };
    const p2 = { x: 3, y: 4 };
    expect(pointDistance(p1, p2)).toBe(5);
  });

  it('detecta esquinas por defecto con margen de seguridad del 6%', () => {
    const quad = detectDefaultCorners(1000, 2000);
    expect(quad.topLeft).toEqual({ x: 60, y: 120 });
    expect(quad.topRight).toEqual({ x: 940, y: 120 });
    expect(quad.bottomRight).toEqual({ x: 940, y: 1880 });
    expect(quad.bottomLeft).toEqual({ x: 60, y: 1880 });
  });

  it('calcula matriz de homografía identidad cuando los puntos coinciden', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const H = getHomographyMatrix(pts, pts);
    expect(H).toHaveLength(9);
    // H00 y H44 deben ser ~1, y los demás términos de diagonal ~1
    expect(Math.abs(H[0] - 1)).toBeLessThan(1e-6);
    expect(Math.abs(H[4] - 1)).toBeLessThan(1e-6);
    expect(Math.abs(H[8] - 1)).toBeLessThan(1e-6);
  });

  it('aplica corrección de perspectiva proyectiva sobre ImageData sin fallar', () => {
    const w = 100;
    const h = 100;
    const rawData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rawData.length; i += 4) {
      rawData[i] = 200; // R
      rawData[i + 1] = 200; // G
      rawData[i + 2] = 200; // B
      rawData[i + 3] = 255; // A
    }

    const mockImg: ImageData = {
      width: w,
      height: h,
      data: rawData,
      colorSpace: 'srgb',
    } as unknown as ImageData;

    const quad = {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 90, y: 10 },
      bottomRight: { x: 80, y: 90 },
      bottomLeft: { x: 20, y: 90 },
    };

    const warped = warpPerspective(mockImg, quad, 80, 80);
    expect(warped.width).toBe(80);
    expect(warped.height).toBe(80);
    expect(warped.data.length).toBe(80 * 80 * 4);
  });

  it('aplica filtro Documento aclarando fondo y preservando contraste', () => {
    const w = 40;
    const h = 40;
    const rawData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rawData.length; i += 4) {
      rawData[i] = 180;
      rawData[i + 1] = 180;
      rawData[i + 2] = 180;
      rawData[i + 3] = 255;
    }
    // Añadir una zona oscura ("texto")
    rawData[0] = 30;
    rawData[1] = 30;
    rawData[2] = 30;

    const mockImg: ImageData = {
      width: w,
      height: h,
      data: rawData,
      colorSpace: 'srgb',
    } as unknown as ImageData;

    const filtered = applyScanFilter(mockImg, 'document');
    expect(filtered.width).toBe(w);
    expect(filtered.height).toBe(h);
  });

  it('aplica filtro Blanco y Negro binarizando en 0 o 255', () => {
    const w = 32;
    const h = 32;
    const rawData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rawData.length; i += 4) {
      rawData[i] = 220;
      rawData[i + 1] = 220;
      rawData[i + 2] = 220;
      rawData[i + 3] = 255;
    }
    // Píxel oscuro
    rawData[0] = 20;
    rawData[1] = 20;
    rawData[2] = 20;

    const mockImg: ImageData = {
      width: w,
      height: h,
      data: rawData,
      colorSpace: 'srgb',
    } as unknown as ImageData;

    const bw = applyScanFilter(mockImg, 'bw');
    // En BN el texto oscuro debe convertirse a 0 y el fondo claro a 255
    expect(bw.data[0]).toBe(0);
    expect(bw.data[4]).toBe(255);
  });
});
