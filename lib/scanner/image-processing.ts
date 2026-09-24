import { Point2D, QuadPoints, ScanFilter } from './types';

/**
 * Calcula la distancia euclidiana entre dos puntos 2D.
 */
export function pointDistance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Resuelve un sistema lineal A * x = b usando eliminación gaussiana con pivoteo parcial.
 */
function solveGaussian(A: number[][], b: number[]): number[] {
  const n = b.length;
  // Crear copia aumentada [A | b]
  const M: number[][] = Array.from({ length: n }, (_, i) => [...A[i], b[i]]);

  for (let k = 0; k < n; k++) {
    // Pivoteo parcial
    let maxRow = k;
    let maxVal = Math.abs(M[k][k]);
    for (let r = k + 1; r < n; r++) {
      if (Math.abs(M[r][k]) > maxVal) {
        maxVal = Math.abs(M[r][k]);
        maxRow = r;
      }
    }
    if (maxVal < 1e-12) {
      throw new Error('Matriz singular en transformación de perspectiva');
    }
    if (maxRow !== k) {
      const temp = M[k];
      M[k] = M[maxRow];
      M[maxRow] = temp;
    }

    // Eliminación
    for (let i = k + 1; i < n; i++) {
      const factor = M[i][k] / M[k][k];
      M[i][k] = 0;
      for (let j = k + 1; j <= n; j++) {
        M[i][j] -= factor * M[k][j];
      }
    }
  }

  // Sustitución regresiva
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) {
      sum -= M[i][j] * x[j];
    }
    x[i] = sum / M[i][i];
  }

  return x;
}

/**
 * Calcula la matriz de homografía 3x3 que mapea los puntos origen (src) a destino (dst).
 */
export function getHomographyMatrix(src: Point2D[], dst: Point2D[]): number[] {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('Se requieren exactamente 4 puntos para homografía');
  }

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  const h = solveGaussian(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/**
 * Aplica transformación de perspectiva proyectiva sobre un ImageData dado el cuadrilátero origen.
 */
export function warpPerspective(
  srcImageData: ImageData,
  quad: QuadPoints,
  targetWidth?: number,
  targetHeight?: number
): ImageData {
  const { width: srcW, height: srcH, data: srcData } = srcImageData;

  // Si no se especifican dimensiones destino, estimar según distancias de los lados
  const topW = pointDistance(quad.topLeft, quad.topRight);
  const bottomW = pointDistance(quad.bottomLeft, quad.bottomRight);
  const leftH = pointDistance(quad.topLeft, quad.bottomLeft);
  const rightH = pointDistance(quad.topRight, quad.bottomRight);

  const outW = Math.round(targetWidth ?? Math.max(topW, bottomW));
  const outH = Math.round(targetHeight ?? Math.max(leftH, rightH));

  if (outW <= 0 || outH <= 0) {
    throw new Error('Dimensiones destino no válidas');
  }

  // Mapear desde destino (rectángulo) hacia origen (quad)
  const dstCorners: Point2D[] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];

  const srcCorners: Point2D[] = [
    quad.topLeft,
    quad.topRight,
    quad.bottomRight,
    quad.bottomLeft,
  ];

  // Matriz inversa H: rect destino -> cuadrilátero origen
  const H = getHomographyMatrix(dstCorners, srcCorners);

  // Crear buffer de salida (utilizable tanto en navegador como Node test)
  let outData: ImageData;
  if (typeof ImageData !== 'undefined') {
    outData = new ImageData(outW, outH);
  } else {
    outData = {
      width: outW,
      height: outH,
      data: new Uint8ClampedArray(outW * outH * 4),
      colorSpace: 'srgb',
    } as unknown as ImageData;
  }
  const dstBuf = outData.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;

      const dstIdx = (y * outW + x) * 4;

      if (sx >= 0 && sx < srcW - 1 && sy >= 0 && sy < srcH - 1) {
        // Interpolación bilineal
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        const fx = sx - x0;
        const fy = sy - y0;

        const i00 = (y0 * srcW + x0) * 4;
        const i10 = (y0 * srcW + x1) * 4;
        const i01 = (y1 * srcW + x0) * 4;
        const i11 = (y1 * srcW + x1) * 4;

        for (let c = 0; c < 3; c++) {
          const top = srcData[i00 + c] * (1 - fx) + srcData[i10 + c] * fx;
          const bottom = srcData[i01 + c] * (1 - fx) + srcData[i11 + c] * fx;
          dstBuf[dstIdx + c] = Math.round(top * (1 - fy) + bottom * fy);
        }
        dstBuf[dstIdx + 3] = 255;
      } else {
        // Fuera de límites
        dstBuf[dstIdx] = 255;
        dstBuf[dstIdx + 1] = 255;
        dstBuf[dstIdx + 2] = 255;
        dstBuf[dstIdx + 3] = 255;
      }
    }
  }

  return outData;
}

export { detectDocumentQuad } from './document-detector';

/**
 * Valida que los 4 puntos formen un cuadrilátero convexo estricto dentro de los límites de la imagen.
 */
export function isValidConvexQuad(quad: QuadPoints, width: number, height: number): boolean {
  const pts = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];

  // Verificar que todos los puntos estén dentro de los límites físicos
  for (const p of pts) {
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) return false;
  }

  // Verificar producto cruzado de los 4 vértices
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % 4];
    const p3 = pts[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-4) return false; // Colineales

    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false; // Auto-intersectado o cóncavo
    }
  }

  return true;
}

/**
 * Estimación inicial de esquinas del documento.
 * Si no se detectan bordes contrastados suficientes, genera un cuadrilátero
 * con margen del 6% del borde para facilitar el ajuste manual del usuario.
 */
export function detectDefaultCorners(width: number, height: number): QuadPoints {
  const mx = Math.round(width * 0.06);
  const my = Math.round(height * 0.06);
  return {
    topLeft: { x: mx, y: my },
    topRight: { x: width - mx, y: my },
    bottomRight: { x: width - mx, y: height - my },
    bottomLeft: { x: mx, y: height - my },
  };
}

/**
 * Aplica filtros de mejora visual de escáner.
 */
export function applyScanFilter(srcData: ImageData, filter: ScanFilter): ImageData {
  const w = srcData.width;
  const h = srcData.height;
  const src = srcData.data;

  let out: ImageData;
  if (typeof ImageData !== 'undefined') {
    out = new ImageData(w, h);
  } else {
    out = {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
      colorSpace: 'srgb',
    } as unknown as ImageData;
  }
  const dst = out.data;

  if (filter === 'original') {
    // Original mejorado: auto-niveles y ligero incremento de nitidez
    // 1. Encontrar percentiles de luminancia
    const lumCounts = new Array(256).fill(0);
    for (let i = 0; i < src.length; i += 4) {
      const lum = Math.round(0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]);
      lumCounts[lum]++;
    }

    const totalPixels = w * h;
    const pLow = Math.floor(totalPixels * 0.02);
    const pHigh = Math.floor(totalPixels * 0.98);

    let cum = 0;
    let minLum = 0;
    let maxLum = 255;

    for (let l = 0; l < 256; l++) {
      cum += lumCounts[l];
      if (cum >= pLow && minLum === 0) minLum = l;
      if (cum >= pHigh) {
        maxLum = l;
        break;
      }
    }
    if (maxLum <= minLum) maxLum = minLum + 1;

    const scale = 255 / (maxLum - minLum);

    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const val = (src[i + c] - minLum) * scale;
        dst[i + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
      dst[i + 3] = 255;
    }
    return out;
  }

  if (filter === 'document') {
    // Documento: aclara el fondo de papel y resalta texto con contraste adaptativo
    // Construir tabla de luminancias en escala de grises
    const gray = new Float32Array(w * h);
    for (let i = 0, g = 0; i < src.length; i += 4, g++) {
      gray[g] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }

    // Estimar fondo local usando bloques de tamaño moderado (~32px)
    const blockSize = Math.max(16, Math.floor(Math.min(w, h) / 20));
    const halfBlock = Math.floor(blockSize / 2);

    // Integral image para promedio local rápido O(1)
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - halfBlock);
      const y2 = Math.min(h, y + halfBlock + 1);

      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - halfBlock);
        const x2 = Math.min(w, x + halfBlock + 1);

        const count = (x2 - x1) * (y2 - y1);
        const sum =
          integral[y2 * (w + 1) + x2] -
          integral[y1 * (w + 1) + x2] -
          integral[y2 * (w + 1) + x1] +
          integral[y1 * (w + 1) + x1];

        const localMean = sum / count;
        const pixelIdx = (y * w + x) * 4;

        for (let c = 0; c < 3; c++) {
          const original = src[pixelIdx + c];
          // Ganancia relativa al fondo
          const gain = localMean > 10 ? (original / localMean) * 220 : original;
          // Curva de contraste sigmoidea suave para empujar blancos y conservar tinta oscura
          const enhanced = gain > 185 ? 255 : gain * 0.95;
          dst[pixelIdx + c] = Math.max(0, Math.min(255, Math.round(enhanced)));
        }
        dst[pixelIdx + 3] = 255;
      }
    }
    return out;
  }

  if (filter === 'bw') {
    // Blanco y negro: Binarización adaptativa local (Sauvola / Bradley)
    const gray = new Float32Array(w * h);
    for (let i = 0, g = 0; i < src.length; i += 4, g++) {
      gray[g] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }

    const s = Math.max(16, Math.floor(w / 16));
    const halfS = Math.floor(s / 2);
    const T = 0.15; // Sensibilidad del umbral Bradley

    // Imagen integral
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - halfS);
      const y2 = Math.min(h, y + halfS + 1);

      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - halfS);
        const x2 = Math.min(w, x + halfS + 1);

        const count = (x2 - x1) * (y2 - y1);
        const sum =
          integral[y2 * (w + 1) + x2] -
          integral[y1 * (w + 1) + x2] -
          integral[y2 * (w + 1) + x1] +
          integral[y1 * (w + 1) + x1];

        const pixelVal = gray[y * w + x];
        const threshold = (sum / count) * (1 - T);

        const binaryVal = pixelVal < threshold ? 0 : 255;
        const dstIdx = (y * w + x) * 4;
        dst[dstIdx] = binaryVal;
        dst[dstIdx + 1] = binaryVal;
        dst[dstIdx + 2] = binaryVal;
        dst[dstIdx + 3] = 255;
      }
    }
    return out;
  }

  return srcData;
}
