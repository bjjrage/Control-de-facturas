import { describe, expect, it, vi } from 'vitest';
import { detectWithEngineFallback } from '../scanner-engine-pipeline';
import type { ScanicDetectionEngine } from '../scanic-detection-engine';
import type { QuadPoints } from '../types';

const candidateQuad: QuadPoints = {
  topLeft: { x: 20, y: 20 },
  topRight: { x: 180, y: 20 },
  bottomRight: { x: 180, y: 180 },
  bottomLeft: { x: 20, y: 180 },
};

function flatImage() {
  const width = 200;
  const height = 200;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 80;
    data[index + 1] = 80;
    data[index + 2] = 80;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

describe('scanner engine fallback pipeline', () => {
  it('returns a valid forced Scanic candidate directly', async () => {
    const scanic = {
      detectFast: vi.fn().mockResolvedValue({
        quad: candidateQuad,
        confidence: 0.86,
        isFallback: false,
        diagnostics: { detector: 'scanic', mode: 'fast', qualityScore: 0.86 },
      }),
    } as unknown as ScanicDetectionEngine;

    const result = await detectWithEngineFallback({
      imageData: flatImage(),
      mode: 'fast',
      enginePreference: 'scanic',
      scanicEngine: scanic,
      cv: null,
    });

    expect(result.diagnostics.detector).toBe('scanic');
    expect(scanic.detectFast).toHaveBeenCalledTimes(1);
  });

  it('falls from a Scanic miss through OpenCV availability to V1', async () => {
    const scanic = {
      detectFast: vi.fn().mockResolvedValue(null),
    } as unknown as ScanicDetectionEngine;

    const result = await detectWithEngineFallback({
      imageData: flatImage(),
      mode: 'fast',
      enginePreference: 'scanic',
      scanicEngine: scanic,
      cv: null,
    });

    expect(result.diagnostics.detector).toBe('v1');
    expect(result.diagnostics.fallbackReason).toContain('scanic-no-valid-candidate');
  });

  it('skips Scanic in auto until its benchmark quality gate is enabled', async () => {
    const scanic = {
      detectFast: vi.fn(),
    } as unknown as ScanicDetectionEngine;

    await detectWithEngineFallback({
      imageData: flatImage(),
      mode: 'fast',
      enginePreference: 'auto',
      scanicEngine: scanic,
      cv: null,
    });

    expect(scanic.detectFast).not.toHaveBeenCalled();
  });
});
