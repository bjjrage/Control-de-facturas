import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanicMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  scan: vi.fn(),
  extractDocument: vi.fn(),
}));

vi.mock('scanic', () => ({
  Scanner: class {
    initialize() {
      return scanicMock.initialize();
    }
    scan(...args: unknown[]) {
      return scanicMock.scan(...args);
    }
  },
  extractDocument: (...args: unknown[]) => scanicMock.extractDocument(...args),
}));

import { ScanicDetectionEngine } from '../scanic-detection-engine';

const validResult = {
  success: true,
  corners: {
    topLeft: { x: 24, y: 20 },
    topRight: { x: 176, y: 24 },
    bottomRight: { x: 174, y: 180 },
    bottomLeft: { x: 20, y: 174 },
  },
  confidence: 0.88,
  timings: [],
  message: 'Document detected',
  output: null,
  contour: null,
  debug: null,
};

function imageData() {
  return {
    width: 200,
    height: 200,
    data: new Uint8ClampedArray(200 * 200 * 4),
    colorSpace: 'srgb' as PredefinedColorSpace,
  };
}

describe('ScanicDetectionEngine', () => {
  beforeEach(() => {
    scanicMock.initialize.mockReset().mockResolvedValue(undefined);
    scanicMock.scan.mockReset().mockResolvedValue(validResult);
    scanicMock.extractDocument.mockReset().mockResolvedValue({
      success: true,
      output: { width: 156, height: 158, data: new Uint8ClampedArray(156 * 158 * 4) },
      corners: validResult.corners,
      message: 'Document extracted',
    });
  });

  it('initializes one reusable scanner and maps ImageData corners into project diagnostics', async () => {
    const engine = new ScanicDetectionEngine();
    await engine.initialize();
    const first = await engine.detectFast({ imageData: imageData() });
    const second = await engine.detectQuality({ imageData: imageData() });

    expect(scanicMock.initialize).toHaveBeenCalledTimes(1);
    expect(scanicMock.scan).toHaveBeenCalledTimes(2);
    expect(scanicMock.scan.mock.calls[0][1]).toMatchObject({
      mode: 'detect',
      maxProcessingDimension: 640,
      enableDetectionCascade: false,
    });
    expect(scanicMock.scan.mock.calls[1][1]).toMatchObject({
      mode: 'detect',
      maxProcessingDimension: 1120,
      enableDetectionCascade: true,
    });
    expect(first?.diagnostics.detector).toBe('scanic');
    expect(first?.diagnostics.qualityScore).toBe(0.88);
    expect(first?.quad.topLeft).toEqual({ x: 24, y: 20 });
    expect(second?.diagnostics.mode).toBe('quality');
    engine.dispose();
  });

  it('rejects absent or low-confidence candidates so the fallback chain can run', async () => {
    scanicMock.scan.mockResolvedValueOnce({ ...validResult, confidence: 0.2 });
    const engine = new ScanicDetectionEngine();

    expect(await engine.detectFast({ imageData: imageData() })).toBeNull();
    engine.dispose();
  });

  it('does not publish an in-flight result after disposal', async () => {
    let resolveScan: ((value: typeof validResult) => void) | undefined;
    scanicMock.scan.mockReturnValueOnce(new Promise((resolve) => {
      resolveScan = resolve;
    }));
    const engine = new ScanicDetectionEngine();
    await engine.initialize();
    const pending = engine.detectFast({ imageData: imageData() });
    await Promise.resolve();
    await Promise.resolve();
    engine.dispose();
    resolveScan?.(validResult);

    expect(await pending).toBeNull();
  });

  it('uses Scanic perspective extraction for a confirmed quad', async () => {
    const engine = new ScanicDetectionEngine();
    await engine.initialize();
    const output = await engine.extractPerspective(imageData(), validResult.corners);

    expect(scanicMock.extractDocument).toHaveBeenCalledWith(
      expect.anything(),
      validResult.corners,
      { output: 'imagedata' }
    );
    expect(output.width).toBe(156);
    engine.dispose();
  });
});
