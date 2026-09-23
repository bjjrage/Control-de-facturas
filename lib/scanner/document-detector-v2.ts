import { isConvexQuad, orderQuadCorners, polygonArea, type ImageDataSource } from './document-detector';
import type { DetectionDiagnostics, Point2D, QuadPoints, ScannerDetectionMode } from './types';
import type { OpenCvMat, OpenCvRuntime } from './opencv-types';

export interface DocumentDetectorV2Options {
  mode?: ScannerDetectionMode;
  maxDimension?: number;
  cannySigma?: number;
  cannyLow?: number;
  cannyHigh?: number;
  morphologyKernelSize?: number;
  edgeSearchRadius?: number;
  seedQuad?: QuadPoints | null;
}

export interface QuadScore {
  total: number;
  areaScore: number;
  edgeContinuity: number;
  edgeCoverage: [number, number, number, number];
  meanEdgeCoverage: number;
  minEdgeCoverage: number;
  convexity: number;
  oppositeSideConsistency: number;
  anglePlausibility: number;
  centerProximity: number;
  borderPenalty: number;
  contrastScore: number;
  temporalConsistency: number;
  areaRatio: number;
}

export interface QuadScoreInput {
  width: number;
  height: number;
  edgePixels?: ArrayLike<number>;
  grayPixels?: ArrayLike<number>;
  seedQuad?: QuadPoints | null;
  edgeSearchRadius?: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function quadArray(quad: QuadPoints): Point2D[] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

function pointToSegmentDistance(point: Point2D, start: Point2D, end: Point2D): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function sampleLineCoverage(
  start: Point2D,
  end: Point2D,
  width: number,
  height: number,
  edgePixels: ArrayLike<number> | undefined,
  searchRadius: number
): number {
  if (!edgePixels) return 0;
  const length = distance(start, end);
  const samples = Math.max(12, Math.ceil(length / 5));
  let covered = 0;

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const x = Math.round(start.x + (end.x - start.x) * t);
    const y = Math.round(start.y + (end.y - start.y) * t);
    let found = false;
    for (let oy = -searchRadius; oy <= searchRadius && !found; oy++) {
      for (let ox = -searchRadius; ox <= searchRadius; ox++) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx >= 0 && sx < width && sy >= 0 && sy < height && edgePixels[sy * width + sx] > 0) {
          found = true;
          break;
        }
      }
    }
    if (found) covered++;
  }

  return covered / (samples + 1);
}

function luminanceAt(grayPixels: ArrayLike<number>, width: number, height: number, point: Point2D): number {
  const x = Math.max(0, Math.min(width - 1, Math.round(point.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(point.y)));
  return grayPixels[y * width + x] ?? 0;
}

function contrastScore(quad: QuadPoints, input: QuadScoreInput): number {
  if (!input.grayPixels) return 0;
  const points = quadArray(quad);
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }), { x: 0, y: 0 });
  let contrast = 0;

  for (let i = 0; i < 4; i++) {
    const start = points[i];
    const end = points[(i + 1) % 4];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const towardCenter = { x: center.x - midpoint.x, y: center.y - midpoint.y };
    const magnitude = Math.max(1, Math.hypot(towardCenter.x, towardCenter.y));
    const normal = { x: towardCenter.x / magnitude, y: towardCenter.y / magnitude };
    const inside = luminanceAt(input.grayPixels, input.width, input.height, {
      x: midpoint.x + normal.x * Math.max(3, Math.min(12, magnitude * 0.04)),
      y: midpoint.y + normal.y * Math.max(3, Math.min(12, magnitude * 0.04)),
    });
    const outside = luminanceAt(input.grayPixels, input.width, input.height, {
      x: midpoint.x - normal.x * Math.max(3, Math.min(12, magnitude * 0.04)),
      y: midpoint.y - normal.y * Math.max(3, Math.min(12, magnitude * 0.04)),
    });
    contrast += Math.min(1, Math.abs(inside - outside) / 64);
  }

  return contrast / 4;
}

function anglePlausibility(quad: QuadPoints): number {
  const points = quadArray(quad);
  const angles: number[] = [];
  for (let i = 0; i < 4; i++) {
    const current = points[i];
    const previous = points[(i + 3) % 4];
    const next = points[(i + 1) % 4];
    const a = { x: previous.x - current.x, y: previous.y - current.y };
    const b = { x: next.x - current.x, y: next.y - current.y };
    const denominator = Math.max(1, Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
    const cosine = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / denominator));
    angles.push((Math.acos(cosine) * 180) / Math.PI);
  }
  const minAngle = Math.min(...angles);
  const maxAngle = Math.max(...angles);
  return clamp01((minAngle - 18) / 38) * clamp01((162 - maxAngle) / 38);
}

function oppositeSideConsistency(quad: QuadPoints): number {
  const points = quadArray(quad);
  const lengths = points.map((point, index) => distance(point, points[(index + 1) % 4]));
  const horizontal = Math.min(lengths[0], lengths[2]) / Math.max(lengths[0], lengths[2], 1);
  const vertical = Math.min(lengths[1], lengths[3]) / Math.max(lengths[1], lengths[3], 1);
  // Perspective may make opposite sides differ substantially; keep the penalty soft.
  return 0.55 * horizontal + 0.45 * vertical;
}

function borderPenalty(quad: QuadPoints, width: number, height: number): number {
  const margin = Math.max(1, Math.min(width, height) * 0.018);
  const points = quadArray(quad);
  const penalties = points.map((point) => {
    const nearest = Math.min(point.x, point.y, width - point.x, height - point.y);
    return nearest >= margin ? 0 : (margin - nearest) / margin;
  });
  return penalties.reduce((sum, value) => sum + value, 0) / 4;
}

function areaScore(areaRatio: number): number {
  if (areaRatio < 0.06 || areaRatio > 0.985) return 0;
  if (areaRatio < 0.18) return clamp01((areaRatio - 0.06) / 0.12);
  if (areaRatio <= 0.72) return 1;
  return clamp01(1 - (areaRatio - 0.72) / 0.27 * 0.55);
}

export function scoreQuadCandidate(quad: QuadPoints, input: QuadScoreInput): QuadScore {
  const points = quadArray(quad);
  const areaRatio = polygonArea(points) / Math.max(1, input.width * input.height);
  const coverage = points.map((point, index) =>
    sampleLineCoverage(
      point,
      points[(index + 1) % 4],
      input.width,
      input.height,
      input.edgePixels,
      input.edgeSearchRadius ?? 3
    )
  ) as [number, number, number, number];
  const meanEdgeCoverage = coverage.reduce((sum, value) => sum + value, 0) / 4;
  const minEdgeCoverage = Math.min(...coverage);
  const convexity = isConvexQuad(points) ? 1 : 0;
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }), { x: 0, y: 0 });
  const centerDistance = distance(center, { x: input.width / 2, y: input.height / 2 });
  const centerProximity = clamp01(1 - centerDistance / (Math.hypot(input.width, input.height) * 0.62));
  const temporalConsistency = input.seedQuad
    ? clamp01(1 - points.reduce((sum, point, index) => sum + distance(point, quadArray(input.seedQuad!)[index]), 0) /
        4 /
        Math.hypot(input.width, input.height) /
        0.25)
    : 0.5;
  const contrast = contrastScore(quad, input);
  const penalty = borderPenalty(quad, input.width, input.height);
  const angle = anglePlausibility(quad);
  const sideConsistency = oppositeSideConsistency(quad);

  const total =
    0.23 * areaScore(areaRatio) +
    0.24 * meanEdgeCoverage +
    0.12 * minEdgeCoverage +
    0.12 * convexity +
    0.08 * sideConsistency +
    0.08 * angle +
    0.04 * centerProximity +
    0.04 * contrast +
    0.12 * temporalConsistency -
    0.08 * penalty;

  return {
    total: clamp01(total),
    areaScore: areaScore(areaRatio),
    edgeContinuity: 0.65 * meanEdgeCoverage + 0.35 * minEdgeCoverage,
    edgeCoverage: coverage,
    meanEdgeCoverage,
    minEdgeCoverage,
    convexity,
    oppositeSideConsistency: sideConsistency,
    anglePlausibility: angle,
    centerProximity,
    borderPenalty: penalty,
    contrastScore: contrast,
    temporalConsistency,
    areaRatio,
  };
}

interface LineEquation {
  a: number;
  b: number;
  c: number;
}

export function fitLineFromPoints(points: Point2D[]): LineEquation | null {
  if (points.length < 6) return null;
  const mean = points.reduce((acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }), { x: 0, y: 0 });
  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  if (xx + yy < 1) return null;
  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };
  return { a: normal.x, b: normal.y, c: -(normal.x * mean.x + normal.y * mean.y) };
}

export function intersectLines(first: LineEquation, second: LineEquation): Point2D | null {
  const determinant = first.a * second.b - second.a * first.b;
  if (Math.abs(determinant) < 1e-7) return null;
  return {
    x: (first.b * second.c - second.b * first.c) / determinant,
    y: (first.c * second.a - second.c * first.a) / determinant,
  };
}

function edgePointsNearSegment(
  start: Point2D,
  end: Point2D,
  width: number,
  height: number,
  edgePixels: ArrayLike<number>,
  tolerance: number
): Point2D[] {
  const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - tolerance));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(start.x, end.x) + tolerance));
  const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - tolerance));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(start.y, end.y) + tolerance));
  const total = (maxX - minX + 1) * (maxY - minY + 1);
  const stride = total > 50000 ? 2 : 1;
  const result: Point2D[] = [];

  for (let y = minY; y <= maxY; y += stride) {
    for (let x = minX; x <= maxX; x += stride) {
      if (edgePixels[y * width + x] > 0 && pointToSegmentDistance({ x, y }, start, end) <= tolerance) {
        result.push({ x, y });
        if (result.length >= 2400) return result;
      }
    }
  }
  return result;
}

export function refineQuadByLines(
  quad: QuadPoints,
  width: number,
  height: number,
  edgePixels: ArrayLike<number>,
  tolerance = 4
): QuadPoints | null {
  const points = quadArray(quad);
  const lines = points.map((point, index) =>
    fitLineFromPoints(edgePointsNearSegment(point, points[(index + 1) % 4], width, height, edgePixels, tolerance))
  );
  if (lines.some((line) => !line)) return null;

  const refined: Point2D[] = [];
  for (let i = 0; i < 4; i++) {
    const point = intersectLines(lines[(i + 3) % 4]!, lines[i]!);
    if (!point) return null;
    refined.push(point);
  }
  if (!isConvexQuad(refined)) return null;
  if (refined.some((point) => point.x < -width * 0.02 || point.x > width * 1.02 || point.y < -height * 0.02 || point.y > height * 1.02)) {
    return null;
  }
  return orderQuadCorners(
    refined.map((point) => ({
      x: Math.max(0, Math.min(width - 1, point.x)),
      y: Math.max(0, Math.min(height - 1, point.y)),
    }))
  );
}

interface LuminanceStats {
  low: number;
  median: number;
  high: number;
}

function imageLuminanceStats(imageData: ImageDataSource): LuminanceStats {
  const values: number[] = [];
  const stride = Math.max(1, Math.floor((imageData.width * imageData.height) / 4096));
  for (let pixel = 0, sample = 0; pixel < imageData.width * imageData.height; pixel += stride, sample++) {
    const index = pixel * 4;
    values.push(0.299 * imageData.data[index] + 0.587 * imageData.data[index + 1] + 0.114 * imageData.data[index + 2]);
  }
  values.sort((a, b) => a - b);
  const at = (ratio: number) => values[Math.min(values.length - 1, Math.floor(values.length * ratio))] ?? 128;
  return { low: at(0.1), median: at(0.5), high: at(0.9) };
}

export function chooseCannyThresholds(
  imageData: ImageDataSource,
  options: Pick<DocumentDetectorV2Options, 'cannyLow' | 'cannyHigh'> = {}
): { low: number; high: number } {
  const stats = imageLuminanceStats(imageData);
  const contrastRange = Math.max(12, stats.high - stats.low);
  const high = Math.round(options.cannyHigh ?? Math.max(40, Math.min(112, 24 + contrastRange * 0.38)));
  const low = Math.round(options.cannyLow ?? Math.max(12, Math.min(high - 10, high * 0.42)));
  return {
    low: Math.max(8, Math.min(high - 8, low)),
    high: Math.max(16, Math.min(180, high)),
  };
}

function readApproxPoints(approx: OpenCvMat): Point2D[] {
  const values = approx.data32S ?? approx.data32F;
  if (!values) return [];
  const points: Point2D[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] });
  return points;
}

function simplifyOrderedPolygon(points: Point2D[]): Point2D[] | null {
  const simplified = points.slice();
  while (simplified.length > 4) {
    let removeIndex = -1;
    let smallestTurn = Infinity;
    for (let i = 0; i < simplified.length; i++) {
      const previous = simplified[(i + simplified.length - 1) % simplified.length];
      const current = simplified[i];
      const next = simplified[(i + 1) % simplified.length];
      const turn = Math.abs((current.x - previous.x) * (next.y - previous.y) - (current.y - previous.y) * (next.x - previous.x));
      if (turn < smallestTurn) {
        smallestTurn = turn;
        removeIndex = i;
      }
    }
    if (removeIndex < 0) return null;
    simplified.splice(removeIndex, 1);
  }
  return simplified.length === 4 && isConvexQuad(simplified) ? simplified : null;
}

function mapQuadToSource(quad: QuadPoints, scaleX: number, scaleY: number): QuadPoints {
  return {
    topLeft: { x: Math.round(quad.topLeft.x * scaleX), y: Math.round(quad.topLeft.y * scaleY) },
    topRight: { x: Math.round(quad.topRight.x * scaleX), y: Math.round(quad.topRight.y * scaleY) },
    bottomRight: { x: Math.round(quad.bottomRight.x * scaleX), y: Math.round(quad.bottomRight.y * scaleY) },
    bottomLeft: { x: Math.round(quad.bottomLeft.x * scaleX), y: Math.round(quad.bottomLeft.y * scaleY) },
  };
}

function emptyDiagnostics(mode: ScannerDetectionMode, processingMs: number): DetectionDiagnostics {
  return {
    detector: 'v2',
    mode,
    processingMs,
    candidateCount: 0,
    meanEdgeCoverage: 0,
    minEdgeCoverage: 0,
    qualityPassAcceptable: false,
    rawQuad: null,
    refinedQuad: null,
  };
}

function safeDelete(value: { delete?: () => void } | null | undefined) {
  try {
    value?.delete?.();
  } catch {
    // OpenCV.js objects can already be released after an exception.
  }
}

export function detectDocumentV2(
  imageData: ImageDataSource,
  cv: OpenCvRuntime,
  options: DocumentDetectorV2Options = {}
): { quad: QuadPoints; confidence: number; isFallback: boolean; diagnostics: DetectionDiagnostics } {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const mode = options.mode ?? 'fast';
  const maxDimension = options.maxDimension ?? (mode === 'fast' ? 640 : mode === 'quality' ? 1280 : Infinity);
  const sourceWidth = imageData.width;
  const sourceHeight = imageData.height;
  const workingScale = Number.isFinite(maxDimension)
    ? Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
    : 1;
  const workingWidth = Math.max(1, Math.round(sourceWidth * workingScale));
  const workingHeight = Math.max(1, Math.round(sourceHeight * workingScale));
  const cannyThresholds = chooseCannyThresholds(imageData, options);
  const lowThreshold = cannyThresholds.low;
  const highThreshold = cannyThresholds.high;
  const kernelSize = options.morphologyKernelSize ?? Math.max(3, Math.min(7, 2 * Math.floor(Math.min(workingWidth, workingHeight) / 320) + 3));

  let source: OpenCvMat | null = null;
  let working: OpenCvMat | null = null;
  let gray: OpenCvMat | null = null;
  let blurred: OpenCvMat | null = null;
  let edges: OpenCvMat | null = null;
  let closed: OpenCvMat | null = null;
  let kernel: OpenCvMat | null = null;
  let contours: { size(): number; get(index: number): OpenCvMat; delete(): void } | null = null;
  let hierarchy: OpenCvMat | null = null;
  const candidates: Array<{ quad: QuadPoints; score: QuadScore }> = [];

  try {
    source = new cv.Mat(sourceHeight, sourceWidth, cv.CV_8UC4);
    source.data.set(imageData.data);
    working = source;
    if (workingScale < 1) {
      working = new cv.Mat();
      cv.resize(source, working, new cv.Size(workingWidth, workingHeight), 0, 0, cv.INTER_AREA ?? cv.INTER_LINEAR);
    }

    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    closed = new cv.Mat();
    cv.cvtColor(working, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT ?? 4);
    cv.Canny(blurred, edges, lowThreshold, highThreshold, 3, false);
    kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kernelSize, kernelSize));
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(closed, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    const edgePixels = closed.data;
    const grayPixels = gray.data;
    const seedInWorking = options.seedQuad
      ? mapQuadToSource(options.seedQuad, workingScale, workingScale)
      : null;

    for (let index = 0; index < contours.size(); index++) {
      const contour = contours.get(index);
      try {
        const contourArea = Math.abs(cv.contourArea(contour, false));
        const perimeter = cv.arcLength(contour, true);
        const areaRatio = contourArea / Math.max(1, workingWidth * workingHeight);
        if (areaRatio < 0.035 || areaRatio > 0.985 || perimeter < Math.hypot(workingWidth, workingHeight) * 0.18) continue;

        const epsilonBase = perimeter;
        for (const epsilonRatio of [0.01, 0.015, 0.02, 0.025, 0.03]) {
          const approx = new cv.Mat();
          try {
            cv.approxPolyDP(contour, approx, epsilonRatio * epsilonBase, true);
            const polygon = readApproxPoints(approx);
            if (polygon.length < 4 || polygon.length > 8) continue;
            const quadPoints = polygon.length === 4 ? polygon : simplifyOrderedPolygon(polygon);
            if (!quadPoints || !isConvexQuad(quadPoints)) continue;
            const ordered = orderQuadCorners(quadPoints);
            const score = scoreQuadCandidate(ordered, {
              width: workingWidth,
              height: workingHeight,
              edgePixels,
              grayPixels,
              seedQuad: seedInWorking,
              edgeSearchRadius: options.edgeSearchRadius ?? (mode === 'fast' ? 2 : 3),
            });
            if (score.areaRatio < 0.06 || score.minEdgeCoverage < 0.12 || score.total < 0.28) continue;
            candidates.push({ quad: ordered, score });
          } finally {
            safeDelete(approx);
          }
        }
      } finally {
        safeDelete(contour);
      }
    }

    candidates.sort((first, second) => second.score.total - first.score.total);
    const best = candidates[0];
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
    if (!best || best.score.total < 0.42) {
      return {
        quad: {
          topLeft: { x: Math.round(sourceWidth * 0.06), y: Math.round(sourceHeight * 0.06) },
          topRight: { x: Math.round(sourceWidth * 0.94), y: Math.round(sourceHeight * 0.06) },
          bottomRight: { x: Math.round(sourceWidth * 0.94), y: Math.round(sourceHeight * 0.94) },
          bottomLeft: { x: Math.round(sourceWidth * 0.06), y: Math.round(sourceHeight * 0.94) },
        },
        confidence: Number((best?.score.total ?? 0.2).toFixed(2)),
        isFallback: true,
        diagnostics: {
          ...emptyDiagnostics(mode, elapsedMs),
          candidateCount: candidates.length,
          fallbackReason: 'no-valid-v2-candidate',
        },
      };
    }

    const edgePixelsArray = closed.data;
    const refinedWorking = refineQuadByLines(
      best.quad,
      workingWidth,
      workingHeight,
      edgePixelsArray,
      options.edgeSearchRadius ?? (mode === 'fast' ? 3 : 5)
    );
    const refinedScore = refinedWorking
      ? scoreQuadCandidate(refinedWorking, {
          width: workingWidth,
          height: workingHeight,
          edgePixels,
          grayPixels,
          seedQuad: seedInWorking,
          edgeSearchRadius: options.edgeSearchRadius ?? (mode === 'fast' ? 2 : 3),
        })
      : null;
    const diagonal = Math.hypot(workingWidth, workingHeight);
    const refinementStayedNearCandidate = refinedWorking
      ? quadArray(refinedWorking).every((point, index) => distance(point, quadArray(best.quad)[index]) <= Math.max(16, diagonal * 0.08))
      : false;
    const refinedIsSafe =
      refinedScore &&
      refinementStayedNearCandidate &&
      refinedScore.total >= best.score.total - 0.005 &&
      refinedScore.minEdgeCoverage >= best.score.minEdgeCoverage - 0.02;
    const winningQuad = refinedIsSafe ? refinedWorking! : best.quad;
    const winningScore = refinedScore && winningQuad === refinedWorking ? refinedScore : best.score;
    const rawQuad = mapQuadToSource(best.quad, 1 / workingScale, 1 / workingScale);
    const refinedQuad = mapQuadToSource(winningQuad, 1 / workingScale, 1 / workingScale);
    const processingMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;

    return {
      quad: refinedQuad,
      confidence: Number(clamp01(0.35 + winningScore.total * 0.65).toFixed(2)),
      isFallback: false,
      diagnostics: {
        detector: 'v2',
        mode,
        processingMs,
        candidateCount: candidates.length,
        areaRatio: winningScore.areaRatio,
        meanEdgeCoverage: winningScore.meanEdgeCoverage,
        minEdgeCoverage: winningScore.minEdgeCoverage,
        edgeCoverage: winningScore.edgeCoverage,
        qualityPassAcceptable:
          winningScore.meanEdgeCoverage >= 0.45 && winningScore.minEdgeCoverage >= 0.28 && winningScore.total >= 0.48,
        rawQuad,
        refinedQuad,
      },
    };
  } finally {
    safeDelete(hierarchy);
    safeDelete(contours);
    safeDelete(kernel);
    safeDelete(closed);
    safeDelete(edges);
    safeDelete(blurred);
    safeDelete(gray);
    if (working && working !== source) safeDelete(working);
    safeDelete(source);
  }
}
