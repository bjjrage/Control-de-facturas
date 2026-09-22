import { polygonArea } from './document-detector';
import type { Point2D, QuadPoints } from './types';

export interface ScannerBenchmarkFixture {
  name: string;
  width: number;
  height: number;
  imageData: Uint8ClampedArray | Uint8Array;
  expectedQuad: QuadPoints;
}

export interface ScannerBenchmarkDetection {
  quad: QuadPoints;
  isFallback: boolean;
  processingMs?: number;
}

export interface ScannerBenchmarkMetrics {
  count: number;
  meanCornerErrorPx: number;
  normalizedCornerErrorPercent: number;
  maxCornerErrorPx: number;
  meanQuadIoU: number;
  detectionSuccessRate: number;
  fallbackRate: number;
  medianProcessingMs: number;
  p95ProcessingMs: number;
}

function points(quad: QuadPoints): Point2D[] {
  return [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
}

function distance(first: Point2D, second: Point2D) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function cross(origin: Point2D, first: Point2D, second: Point2D) {
  return (first.x - origin.x) * (second.y - origin.y) - (first.y - origin.y) * (second.x - origin.x);
}

function inside(point: Point2D, edgeStart: Point2D, edgeEnd: Point2D) {
  return cross(edgeStart, edgeEnd, point) >= -1e-6;
}

function lineIntersection(firstStart: Point2D, firstEnd: Point2D, secondStart: Point2D, secondEnd: Point2D): Point2D {
  const a1 = firstEnd.y - firstStart.y;
  const b1 = firstStart.x - firstEnd.x;
  const c1 = a1 * firstStart.x + b1 * firstStart.y;
  const a2 = secondEnd.y - secondStart.y;
  const b2 = secondStart.x - secondEnd.x;
  const c2 = a2 * secondStart.x + b2 * secondStart.y;
  const determinant = a1 * b2 - a2 * b1;
  if (Math.abs(determinant) < 1e-7) return firstEnd;
  return { x: (b2 * c1 - b1 * c2) / determinant, y: (a1 * c2 - a2 * c1) / determinant };
}

function polygonIntersection(subject: Point2D[], clip: Point2D[]): Point2D[] {
  let output = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (input.length === 0) break;
    let previous = input[input.length - 1];
    for (const current of input) {
      const currentInside = inside(current, edgeStart, edgeEnd);
      const previousInside = inside(previous, edgeStart, edgeEnd);
      if (currentInside !== previousInside) {
        output.push(lineIntersection(previous, current, edgeStart, edgeEnd));
      }
      if (currentInside) output.push(current);
      previous = current;
    }
  }
  return output;
}

export function quadIoU(first: QuadPoints, second: QuadPoints): number {
  const firstArea = polygonArea(points(first));
  const secondArea = polygonArea(points(second));
  const intersection = polygonArea(polygonIntersection(points(first), points(second)));
  const union = firstArea + secondArea - intersection;
  return union > 0 ? intersection / union : 0;
}

export function evaluateScannerDetection(
  expectedQuad: QuadPoints,
  detection: ScannerBenchmarkDetection,
  width: number,
  height: number
) {
  const expected = points(expectedQuad);
  const actual = points(detection.quad);
  const errors = expected.map((point, index) => distance(point, actual[index]));
  const diagonal = Math.max(1, Math.hypot(width, height));
  return {
    meanCornerErrorPx: errors.reduce((sum, value) => sum + value, 0) / 4,
    normalizedCornerErrorPercent: (errors.reduce((sum, value) => sum + value, 0) / 4 / diagonal) * 100,
    maxCornerErrorPx: Math.max(...errors),
    quadIoU: quadIoU(expectedQuad, detection.quad),
    success: !detection.isFallback,
    processingMs: detection.processingMs ?? 0,
  };
}

function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

export function summarizeScannerBenchmark(rows: ReturnType<typeof evaluateScannerDetection>[]): ScannerBenchmarkMetrics {
  const count = rows.length;
  if (count === 0) {
    return {
      count: 0,
      meanCornerErrorPx: 0,
      normalizedCornerErrorPercent: 0,
      maxCornerErrorPx: 0,
      meanQuadIoU: 0,
      detectionSuccessRate: 0,
      fallbackRate: 0,
      medianProcessingMs: 0,
      p95ProcessingMs: 0,
    };
  }
  const processing = rows.map((row) => row.processingMs);
  return {
    count,
    meanCornerErrorPx: rows.reduce((sum, row) => sum + row.meanCornerErrorPx, 0) / count,
    normalizedCornerErrorPercent: rows.reduce((sum, row) => sum + row.normalizedCornerErrorPercent, 0) / count,
    maxCornerErrorPx: Math.max(...rows.map((row) => row.maxCornerErrorPx)),
    meanQuadIoU: rows.reduce((sum, row) => sum + row.quadIoU, 0) / count,
    detectionSuccessRate: rows.filter((row) => row.success).length / count,
    fallbackRate: rows.filter((row) => !row.success).length / count,
    medianProcessingMs: percentile(processing, 0.5),
    p95ProcessingMs: percentile(processing, 0.95),
  };
}

export function formatScannerBenchmark(label: string, metrics: ScannerBenchmarkMetrics): string {
  return [
    label,
    `  fixtures: ${metrics.count}`,
    `  mean corner error: ${metrics.meanCornerErrorPx.toFixed(2)} px`,
    `  normalized corner error: ${metrics.normalizedCornerErrorPercent.toFixed(2)}%`,
    `  max corner error: ${metrics.maxCornerErrorPx.toFixed(2)} px`,
    `  quad IoU: ${(metrics.meanQuadIoU * 100).toFixed(2)}%`,
    `  detection success: ${(metrics.detectionSuccessRate * 100).toFixed(2)}%`,
    `  fallback rate: ${(metrics.fallbackRate * 100).toFixed(2)}%`,
    `  processing median/p95: ${metrics.medianProcessingMs.toFixed(2)} / ${metrics.p95ProcessingMs.toFixed(2)} ms`,
  ].join('\n');
}
