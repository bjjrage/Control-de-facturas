import { describe, expect, it } from 'vitest';
import {
  evaluateScannerDetection,
  quadIoU,
  summarizeScannerABBenchmark,
  summarizeScannerBenchmark,
} from '../scanner-benchmark';

const expected = {
  topLeft: { x: 10, y: 10 },
  topRight: { x: 110, y: 10 },
  bottomRight: { x: 110, y: 210 },
  bottomLeft: { x: 10, y: 210 },
};

describe('scanner benchmark utilities', () => {
  it('calculates IoU for identical quads', () => {
    expect(quadIoU(expected, expected)).toBeCloseTo(1, 5);
  });

  it('reports corner errors and fallback metrics', () => {
    const row = evaluateScannerDetection(
      expected,
      { quad: { ...expected, topLeft: { x: 20, y: 20 } }, isFallback: false, processingMs: 12 },
      120,
      220
    );
    expect(row.meanCornerErrorPx).toBeGreaterThan(0);
    expect(row.quadIoU).toBeLessThan(1);
  });

  it('summarizes success and timing percentiles', () => {
    const rows = [
      evaluateScannerDetection(expected, { quad: expected, isFallback: false, processingMs: 10 }, 120, 220),
      evaluateScannerDetection(expected, { quad: expected, isFallback: true, processingMs: 20 }, 120, 220),
    ];
    const summary = summarizeScannerBenchmark(rows);
    expect(summary.detectionSuccessRate).toBe(0.5);
    expect(summary.fallbackRate).toBe(0.5);
    expect(summary.p95ProcessingMs).toBe(20);
  });

  it('penalizes missed positives and counts false detections on empty scenes', () => {
    const summary = summarizeScannerABBenchmark([
      {
        name: 'paper',
        width: 120,
        height: 220,
        expectedQuad: expected,
        detectedQuad: null,
        detected: false,
        fallback: true,
        processingMs: 12,
      },
      {
        name: 'empty',
        width: 120,
        height: 220,
        expectedQuad: null,
        detectedQuad: expected,
        detected: true,
        fallback: false,
        processingMs: 8,
      },
    ]);

    expect(summary.detectionSuccessRate).toBe(0);
    expect(summary.falseDetectionRate).toBe(1);
    expect(summary.fallbackRate).toBe(0.5);
    expect(summary.meanCornerErrorPx).toBeCloseTo(Math.hypot(120, 220), 4);
    expect(summary.processingMeanMs).toBe(10);
  });
});
