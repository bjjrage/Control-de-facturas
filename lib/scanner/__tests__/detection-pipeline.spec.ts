import { describe, expect, it } from 'vitest';
import { detectWithFallback } from '../detection-pipeline';

function uniformImage(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 90;
    data[index + 1] = 90;
    data[index + 2] = 90;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

describe('scanner detection fallback pipeline', () => {
  it('uses V1 when OpenCV is unavailable', () => {
    const result = detectWithFallback({ imageData: uniformImage(64, 64), mode: 'fast', cv: null });
    expect(result.diagnostics.detector).toBe('v1');
    expect(result.diagnostics.fallbackReason).toBe('opencv-not-ready');
  });

  it('never throws for a failed OpenCV runtime', () => {
    const brokenRuntime = {} as never;
    const result = detectWithFallback({ imageData: uniformImage(64, 64), mode: 'quality', cv: brokenRuntime });
    expect(result.diagnostics.detector).toBe('v1');
    expect(result.diagnostics.fallbackReason).toBe('opencv-error');
  });
});
