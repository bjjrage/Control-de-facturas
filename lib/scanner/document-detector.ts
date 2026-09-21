import { DetectedQuadResult, Point2D, QuadPoints } from './types';

/**
 * Calcula la distancia euclidiana entre dos puntos.
 */
function dist(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calcula el área de un polígono simple usando la fórmula de Gauss (Shoelace formula).
 */
export function polygonArea(points: Point2D[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Verifica si 4 vértices forman un cuadrilátero convexo válido sin auto-intersección.
 */
export function isConvexQuad(p: Point2D[]): boolean {
  if (p.length !== 4) return false;

  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p1 = p[i];
    const p2 = p[(i + 1) % 4];
    const p3 = p[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-6) return false; // Puntos colineales

    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false; // Cambio de signo -> cóncavo o auto-intersectado
    }
  }

  return true;
}

/**
 * Ordena canónicamente 4 puntos como: Top-Left, Top-Right, Bottom-Right, Bottom-Left.
 */
export function orderQuadCorners(pts: Point2D[]): QuadPoints {
  if (pts.length !== 4) {
    throw new Error('Se requieren exactamente 4 puntos');
  }

  // 1. Calcular centroide geométrico
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;

  // 2. Ordenar en sentido horario alrededor del centroide
  const sorted = pts.slice().sort((a, b) => {
    const angleA = Math.atan2(a.y - cy, a.x - cx);
    const angleB = Math.atan2(b.y - cy, b.x - cx);
    return angleA - angleB;
  });

  // 3. Buscar el vértice que minimiza (x + y) como Top-Left canónico
  let tlIndex = 0;
  let minSum = Infinity;
  for (let i = 0; i < 4; i++) {
    const sum = sorted[i].x + sorted[i].y;
    if (sum < minSum) {
      minSum = sum;
      tlIndex = i;
    }
  }

  // 4. En orden horario garantizado: TL, TR, BR, BL
  return {
    topLeft: sorted[tlIndex],
    topRight: sorted[(tlIndex + 1) % 4],
    bottomRight: sorted[(tlIndex + 2) % 4],
    bottomLeft: sorted[(tlIndex + 3) % 4],
  };
}

/**
 * Monotone Chain Convex Hull algorithm
 */
export function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points.slice();

  const sorted = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Reduce un polígono convexo a exactamente 4 vértices removiendo sucesivamente
 * el vértice que forma el triángulo de menor área (Visvalingam-Whyatt).
 */
export function simplifyToQuad(hull: Point2D[]): Point2D[] {
  const pts = hull.slice();
  while (pts.length > 4) {
    let minArea = Infinity;
    let removeIdx = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i + n - 1) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      const area = Math.abs(
        (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x)
      );
      if (area < minArea) {
        minArea = area;
        removeIdx = i;
      }
    }
    pts.splice(removeIdx, 1);
  }
  return pts;
}

export type ImageDataSource = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
};

/**
 * Pipeline real de visión por computadora para detección de documentos tipo CamScanner.
 */
export function detectDocumentQuad(srcImageData: ImageDataSource): DetectedQuadResult {
  const { width: origW, height: origH, data: src } = srcImageData;

  // 1. Downsampling a resolución máxima de 320px para ejecución <20ms
  const targetMaxDim = 320;
  const scale = Math.max(origW, origH) > targetMaxDim ? targetMaxDim / Math.max(origW, origH) : 1;

  const downW = Math.round(origW * scale);
  const downH = Math.round(origH * scale);

  // Buffer de escala de grises
  const gray = new Float32Array(downW * downH);

  for (let y = 0; y < downH; y++) {
    const srcY = Math.min(origH - 1, Math.floor(y / scale));
    for (let x = 0; x < downW; x++) {
      const srcX = Math.min(origW - 1, Math.floor(x / scale));
      const idx = (srcY * origW + srcX) * 4;
      gray[y * downW + x] = 0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2];
    }
  }

  // 2. Filtro Gaussiano 5x5 separable [1, 4, 6, 4, 1] / 16
  const blurHoriz = new Float32Array(downW * downH);
  for (let y = 0; y < downH; y++) {
    const row = y * downW;
    for (let x = 0; x < downW; x++) {
      const xm2 = Math.max(0, x - 2);
      const xm1 = Math.max(0, x - 1);
      const xp1 = Math.min(downW - 1, x + 1);
      const xp2 = Math.min(downW - 1, x + 2);
      blurHoriz[row + x] =
        (gray[row + xm2] +
          4 * gray[row + xm1] +
          6 * gray[row + x] +
          4 * gray[row + xp1] +
          gray[row + xp2]) /
        16;
    }
  }

  const blurred = new Float32Array(downW * downH);
  for (let y = 0; y < downH; y++) {
    const ym2 = Math.max(0, y - 2) * downW;
    const ym1 = Math.max(0, y - 1) * downW;
    const y0 = y * downW;
    const yp1 = Math.min(downH - 1, y + 1) * downW;
    const yp2 = Math.min(downH - 1, y + 2) * downW;

    for (let x = 0; x < downW; x++) {
      blurred[y0 + x] =
        (blurHoriz[ym2 + x] +
          4 * blurHoriz[ym1 + x] +
          6 * blurHoriz[y0 + x] +
          4 * blurHoriz[yp1 + x] +
          blurHoriz[yp2 + x]) /
        16;
    }
  }

  // 3. Gradiente de Sobel y cálculo de magnitud
  const gradMag = new Float32Array(downW * downH);
  let gradSum = 0;

  for (let y = 1; y < downH - 1; y++) {
    const ym1 = (y - 1) * downW;
    const y0 = y * downW;
    const yp1 = (y + 1) * downW;

    for (let x = 1; x < downW - 1; x++) {
      // Sobel X: [-1, 0, 1; -2, 0, 2; -1, 0, 1]
      const gx =
        -blurred[ym1 + x - 1] +
        blurred[ym1 + x + 1] -
        2 * blurred[y0 + x - 1] +
        2 * blurred[y0 + x + 1] -
        blurred[yp1 + x - 1] +
        blurred[yp1 + x + 1];

      // Sobel Y: [-1, -2, -1; 0, 0, 0; 1, 2, 1]
      const gy =
        -blurred[ym1 + x - 1] -
        2 * blurred[ym1 + x] -
        blurred[ym1 + x + 1] +
        blurred[yp1 + x - 1] +
        2 * blurred[yp1 + x] +
        blurred[yp1 + x + 1];

      const mag = Math.hypot(gx, gy);
      gradMag[y0 + x] = mag;
      gradSum += mag;
    }
  }

  const avgGrad = gradSum / ((downW - 2) * (downH - 2) || 1);
  const threshold = Math.max(12, avgGrad * 1.25);

  // 4. Mapa binario de bordes
  const edges = new Uint8Array(downW * downH);
  for (let i = 0; i < gradMag.length; i++) {
    if (gradMag[i] > threshold) edges[i] = 1;
  }

  // 5. Muestreo perimetral omnidireccional para capturar contornos de documentos
  const boundaryPoints: Point2D[] = [];
  const cx = downW / 2;
  const cy = downH / 2;
  const maxRadius = Math.hypot(cx, cy);

  // 5a. Rayos radiales desde afuera hacia el centro (48 rayos)
  const numRays = 48;
  for (let i = 0; i < numRays; i++) {
    const angle = (i * 2 * Math.PI) / numRays;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    for (let r = maxRadius; r >= 10; r -= 2) {
      const px = Math.round(cx + cosA * r);
      const py = Math.round(cy + sinA * r);
      if (px >= 1 && px < downW - 1 && py >= 1 && py < downH - 1) {
        if (edges[py * downW + px] === 1) {
          boundaryPoints.push({ x: px, y: py });
          break;
        }
      }
    }
  }

  // 5b. Barrido ortogonal desde los 4 bordes (cada 6px)
  for (let x = 4; x < downW - 4; x += 6) {
    for (let y = 1; y < downH - 1; y += 2) {
      if (edges[y * downW + x] === 1) {
        boundaryPoints.push({ x, y });
        break;
      }
    }
    for (let y = downH - 2; y >= 1; y -= 2) {
      if (edges[y * downW + x] === 1) {
        boundaryPoints.push({ x, y });
        break;
      }
    }
  }

  for (let y = 4; y < downH - 4; y += 6) {
    for (let x = 1; x < downW - 1; x += 2) {
      if (edges[y * downW + x] === 1) {
        boundaryPoints.push({ x, y });
        break;
      }
    }
    for (let x = downW - 2; x >= 1; x -= 2) {
      if (edges[y * downW + x] === 1) {
        boundaryPoints.push({ x, y });
        break;
      }
    }
  }

  // 5c. Extraer componentes conectados de bordes para aislar documentos cuando hay múltiples objetos
  const visited = new Uint8Array(downW * downH);
  const components: Point2D[][] = [];

  for (let y = 2; y < downH - 2; y += 2) {
    for (let x = 2; x < downW - 2; x += 2) {
      const idx = y * downW + x;
      if (edges[idx] === 1 && visited[idx] === 0) {
        const comp: Point2D[] = [];
        const queue: number[] = [x, y];
        visited[idx] = 1;
        let head = 0;

        while (head < queue.length && comp.length < 5000) {
          const qx = queue[head++];
          const qy = queue[head++];
          comp.push({ x: qx, y: qy });

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = qx + dx;
              const ny = qy + dy;
              if (nx >= 1 && nx < downW - 1 && ny >= 1 && ny < downH - 1) {
                const nIdx = ny * downW + nx;
                if (edges[nIdx] === 1 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  queue.push(nx, ny);
                }
              }
            }
          }
        }

        if (comp.length >= 20) {
          components.push(comp);
        }
      }
    }
  }

  components.sort((a, b) => b.length - a.length);

  const candidates: Array<{ points: Point2D[]; score: number; confidence: number }> = [];

  const evaluateCandidate = (pts: Point2D[]) => {
    const area = polygonArea(pts);
    const totalImageArea = downW * downH;
    const areaRatio = area / totalImageArea;
    if (areaRatio < 0.08 || areaRatio > 0.96) return;

    // Ortogonalidad
    let angleScore = 1.0;
    for (let j = 0; j < 4; j++) {
      const pPrev = pts[(j + 3) % 4];
      const pCurr = pts[j];
      const pNext = pts[(j + 1) % 4];
      const v1 = { x: pPrev.x - pCurr.x, y: pPrev.y - pCurr.y };
      const v2 = { x: pNext.x - pCurr.x, y: pNext.y - pCurr.y };
      const dot = v1.x * v2.x + v1.y * v2.y;
      const magProduct = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
      const cosAngle = Math.abs(dot / (magProduct || 1));
      angleScore *= 1.0 - Math.min(1.0, cosAngle * 1.2);
    }

    // Fuerza y cobertura de bordes
    let edgeGradTotal = 0;
    let edgeCoverageCount = 0;
    let samples = 0;
    for (let j = 0; j < 4; j++) {
      const p1 = pts[j];
      const p2 = pts[(j + 1) % 4];
      const sideDist = dist(p1, p2);
      const stepCount = Math.max(5, Math.floor(sideDist / 4));
      for (let s = 0; s <= stepCount; s++) {
        const t = s / stepCount;
        const sx = Math.round(p1.x + (p2.x - p1.x) * t);
        const sy = Math.round(p1.y + (p2.y - p1.y) * t);
        if (sx >= 0 && sx < downW && sy >= 0 && sy < downH) {
          const mag = gradMag[sy * downW + sx];
          edgeGradTotal += mag;
          if (mag > threshold * 0.7) {
            edgeCoverageCount++;
          }
          samples++;
        }
      }
    }
    const avgSideGrad = edgeGradTotal / (samples || 1);
    const gradScore = Math.min(1.0, avgSideGrad / (threshold * 1.05));
    const coverageScore = edgeCoverageCount / (samples || 1);

    const combinedScore =
      0.35 * Math.min(1.0, areaRatio * 1.5) +
      0.35 * gradScore * coverageScore +
      0.30 * angleScore;

    const confidence = Math.min(
      0.95,
      Math.max(
        0.50,
        0.30 +
          0.35 * coverageScore +
          0.20 * angleScore +
          0.15 * Math.min(1.0, areaRatio * 2)
      )
    );

    candidates.push({ points: pts, score: combinedScore, confidence });
  };

  // Si hay más de un componente de borde desconectado (ej. dos documentos en la mesa),
  // evaluar cada documento individualmente para no fusionar ambos con espacio vacío
  const pointSets: Point2D[][] =
    components.length > 1
      ? components.slice(0, 3)
      : [boundaryPoints, ...components.slice(0, 1)];

  for (const pSet of pointSets) {
    if (pSet.length >= 8) {
      const hull = computeConvexHull(pSet);
      if (hull.length >= 4) {
        const quad1 = simplifyToQuad(hull);
        if (quad1.length === 4 && isConvexQuad(quad1)) {
          evaluateCandidate(quad1);
        }

        const testAngles = [-0.3, -0.15, 0, 0.15, 0.3];
        for (const ang of testAngles) {
          const cos = Math.cos(ang);
          const sin = Math.sin(ang);
          let minSum = Infinity;
          let maxSum = -Infinity;
          let minDiff = Infinity;
          let maxDiff = -Infinity;
          let pTL = hull[0];
          let pBR = hull[0];
          let pTR = hull[0];
          let pBL = hull[0];

          for (const p of hull) {
            const rx = p.x * cos - p.y * sin;
            const ry = p.x * sin + p.y * cos;
            const sum = rx + ry;
            const diff = rx - ry;
            if (sum < minSum) {
              minSum = sum;
              pTL = p;
            }
            if (sum > maxSum) {
              maxSum = sum;
              pBR = p;
            }
            if (diff > maxDiff) {
              maxDiff = diff;
              pTR = p;
            }
            if (diff < minDiff) {
              minDiff = diff;
              pBL = p;
            }
          }

          const quadRot = [pTL, pTR, pBR, pBL];
          const uniqueKeys = new Set(quadRot.map((p) => `${p.x},${p.y}`));
          if (uniqueKeys.size === 4 && isConvexQuad(quadRot)) {
            evaluateCandidate(quadRot);
          }
        }
      }
    }
  }

  // 6. Selección del candidato óptimo
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    if (best.score >= 0.40) {
      const ordered = orderQuadCorners(best.points);
      const scaledQuad: QuadPoints = {
        topLeft: {
          x: Math.max(0, Math.min(origW, Math.round(ordered.topLeft.x / scale))),
          y: Math.max(0, Math.min(origH, Math.round(ordered.topLeft.y / scale))),
        },
        topRight: {
          x: Math.max(0, Math.min(origW, Math.round(ordered.topRight.x / scale))),
          y: Math.max(0, Math.min(origH, Math.round(ordered.topRight.y / scale))),
        },
        bottomRight: {
          x: Math.max(0, Math.min(origW, Math.round(ordered.bottomRight.x / scale))),
          y: Math.max(0, Math.min(origH, Math.round(ordered.bottomRight.y / scale))),
        },
        bottomLeft: {
          x: Math.max(0, Math.min(origW, Math.round(ordered.bottomLeft.x / scale))),
          y: Math.max(0, Math.min(origH, Math.round(ordered.bottomLeft.y / scale))),
        },
      };

      return {
        quad: scaledQuad,
        confidence: Number((best as any).confidence ? (best as any).confidence.toFixed(2) : best.score.toFixed(2)),
        isFallback: false,
      };
    }
  }

  const fallbackQuad = createFallbackQuad(origW, origH);

  return {
    quad: fallbackQuad,
    confidence: candidates.length > 0 ? Number(candidates[0].score.toFixed(2)) : 0.2,
    isFallback: true,
  };
}

export function createFallbackQuad(width: number, height: number): QuadPoints {
  const mx = Math.round(width * 0.06);
  const my = Math.round(height * 0.06);
  return {
    topLeft: { x: mx, y: my },
    topRight: { x: width - mx, y: my },
    bottomRight: { x: width - mx, y: height - my },
    bottomLeft: { x: mx, y: height - my },
  };
}

export function detectDocumentFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): DetectedQuadResult {
  return detectDocumentQuad({ width, height, data: rgba });
}

export const orderQuadPoints = orderQuadCorners;


