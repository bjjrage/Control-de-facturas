import type { ImageDataSource } from './document-detector';
import { detectWithFallback, type DetectionPipelineResult } from './detection-pipeline';
import type { ScannerDetectionEngine, ScannerDetectionInput } from './scanner-detection-engine';
import { warpPerspective } from './image-processing';
import type { QuadPoints, ScannerDetectionMode } from './types';

/**
 * Adapter for the existing OpenCV V2 -> V1 pipeline.
 * It does not own the global OpenCV runtime, so dispose only drops this adapter's reference.
 */
export class OpenCvDetectionEngine implements ScannerDetectionEngine {
  private disposed = false;

  async detectFast(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null> {
    return this.detect(input, 'fast');
  }

  async detectQuality(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null> {
    return this.detect(input, 'quality');
  }

  async refineFinal(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null> {
    return this.detect(input, 'final');
  }

  async extractPerspective(imageData: ImageData, quad: QuadPoints): Promise<ImageData> {
    if (this.disposed) throw new Error('OpenCV detection engine has been disposed');
    return warpPerspective(imageData, quad);
  }

  dispose(): void {
    this.disposed = true;
  }

  private async detect(
    input: ScannerDetectionInput,
    mode: ScannerDetectionMode
  ): Promise<DetectionPipelineResult | null> {
    if (this.disposed) return null;
    return detectWithFallback({
      imageData: input.imageData,
      mode,
      cv: input.cv ?? null,
      seedQuad: input.seedQuad,
    });
  }
}
