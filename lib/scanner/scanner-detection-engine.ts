import type { ImageDataSource } from './document-detector';
import type { DetectionPipelineResult } from './detection-pipeline';
import type { OpenCvRuntime } from './opencv-types';
import type { QuadPoints } from './types';

export interface ScannerDetectionInput {
  imageData: ImageDataSource;
  cv?: OpenCvRuntime | null;
  seedQuad?: QuadPoints | null;
}

export interface ScannerDetectionEngine {
  detectFast(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null>;
  detectQuality(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null>;
  refineFinal(input: ScannerDetectionInput): Promise<DetectionPipelineResult | null>;
  extractPerspective(imageData: ImageData, quad: QuadPoints): Promise<ImageData>;
  dispose(): void;
}
