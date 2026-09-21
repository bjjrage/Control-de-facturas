import { detectDocumentFromRgba } from '../lib/scanner/document-detector';
import { describe, it } from 'vitest';
import {
  evaluateScannerDetection,
  formatScannerBenchmark,
  summarizeScannerBenchmark,
  type ScannerBenchmarkFixture,
} from '../lib/scanner/scanner-benchmark';

function createFixture(name: string, expectedQuad: ScannerBenchmarkFixture['expectedQuad']): ScannerBenchmarkFixture {
  const width = 640;
  const height = 480;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 34;
    data[i + 1] = 34;
    data[i + 2] = 34;
    data[i + 3] = 255;
  }
  const polygon = [expectedQuad.topLeft, expectedQuad.topRight, expectedQuad.bottomRight, expectedQuad.bottomLeft];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      if (inside) {
        const index = (y * width + x) * 4;
        data[index] = 242;
        data[index + 1] = 242;
        data[index + 2] = 242;
      }
    }
  }
  return { name, width, height, imageData: data, expectedQuad };
}

describe('scanner benchmark command', () => {
  it('prints the V1 baseline and leaves the V2 browser runtime explicit', () => {
const fixtures = [
  createFixture('synthetic-dark-table', {
    topLeft: { x: 80, y: 50 },
    topRight: { x: 560, y: 70 },
    bottomRight: { x: 580, y: 430 },
    bottomLeft: { x: 60, y: 410 },
  }),
];

const v1Rows = fixtures.map((fixture) => {
  const startedAt = performance.now();
  const result = detectDocumentFromRgba(fixture.imageData, fixture.width, fixture.height);
  return evaluateScannerDetection(
    fixture.expectedQuad,
    { quad: result.quad, isFallback: result.isFallback, processingMs: performance.now() - startedAt },
    fixture.width,
    fixture.height
  );
});

console.log('SCANNER BENCHMARK V1 vs V2');
console.log(formatScannerBenchmark('V1 baseline', summarizeScannerBenchmark(v1Rows)));
console.log('V2: browser runtime required for OpenCV.js. Add public fixtures and run the browser benchmark harness before making a performance claim.');
  });
});
