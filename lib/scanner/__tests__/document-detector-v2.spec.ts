import { describe, expect, it } from 'vitest';
import { fitLineFromPoints, intersectLines, refineQuadByLines, scoreQuadCandidate } from '../document-detector-v2';

const quad = {
  topLeft: { x: 20, y: 20 },
  topRight: { x: 180, y: 25 },
  bottomRight: { x: 175, y: 180 },
  bottomLeft: { x: 25, y: 175 },
};

function edgeMap(width: number, height: number) {
  const edges = new Uint8Array(width * height);
  const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];
  for (let i = 0; i < points.length; i++) {
    const start = points[i];
    const end = points[(i + 1) % points.length];
    const length = Math.ceil(Math.hypot(end.x - start.x, end.y - start.y));
    for (let step = 0; step <= length; step++) {
      const t = step / length;
      const x = Math.round(start.x + (end.x - start.x) * t);
      const y = Math.round(start.y + (end.y - start.y) * t);
      edges[y * width + x] = 255;
    }
  }
  return edges;
}

describe('document detector V2 geometry', () => {
  it('scores all four sides and penalizes a missing side', () => {
    const edges = edgeMap(200, 200);
    const score = scoreQuadCandidate(quad, { width: 200, height: 200, edgePixels: edges });
    expect(score.meanEdgeCoverage).toBeGreaterThan(0.9);
    expect(score.minEdgeCoverage).toBeGreaterThan(0.9);

    const missingSide = edges.slice();
    for (let y = 20; y < 30; y++) for (let x = 20; x < 180; x++) missingSide[y * 200 + x] = 0;
    const worse = scoreQuadCandidate(quad, { width: 200, height: 200, edgePixels: missingSide });
    expect(worse.minEdgeCoverage).toBeLessThan(score.minEdgeCoverage);
    expect(worse.total).toBeLessThan(score.total);
  });

  it('fits a line and intersects adjacent lines', () => {
    const line = fitLineFromPoints([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 50, y: 20 },
      { x: 70, y: 20 },
      { x: 90, y: 20 },
      { x: 110, y: 20 },
    ]);
    const vertical = fitLineFromPoints([
      { x: 10, y: 10 },
      { x: 10, y: 30 },
      { x: 10, y: 50 },
      { x: 10, y: 70 },
      { x: 10, y: 90 },
      { x: 10, y: 110 },
    ]);
    expect(line).not.toBeNull();
    expect(vertical).not.toBeNull();
    const intersection = intersectLines(line!, vertical!);
    expect(intersection?.x).toBeCloseTo(10, 2);
    expect(intersection?.y).toBeCloseTo(20, 2);
  });

  it('refines vertices from edge pixels instead of reusing the seed vertices', () => {
    const edges = edgeMap(200, 200);
    const rough = {
      topLeft: { x: 25, y: 25 },
      topRight: { x: 176, y: 28 },
      bottomRight: { x: 173, y: 176 },
      bottomLeft: { x: 27, y: 172 },
    };
    const refined = refineQuadByLines(rough, 200, 200, edges, 8);
    expect(refined).not.toBeNull();
    expect(refined!.topLeft.x).toBeGreaterThan(19);
    expect(refined!.topLeft.x).toBeLessThan(22);
    expect(refined!.topLeft.y).toBeGreaterThan(19);
    expect(refined!.topLeft.y).toBeLessThan(22);
  });
});
