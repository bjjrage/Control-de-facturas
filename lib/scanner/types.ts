export type ScanSessionStatus =
  | 'waiting'
  | 'connected'
  | 'scanning'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'canceled';

export type ScanFilter = 'original' | 'document' | 'bw';

export interface Point2D {
  x: number;
  y: number;
}

export interface QuadPoints {
  topLeft: Point2D;
  topRight: Point2D;
  bottomRight: Point2D;
  bottomLeft: Point2D;
}

export interface DetectedQuadResult {
  quad: QuadPoints;
  confidence: number;
  isFallback: boolean;
  diagnostics?: DetectionDiagnostics;
}

export type ScannerDetectorName = 'v1' | 'v2';
export type ScannerDetectionMode = 'fast' | 'quality' | 'final';

export interface DetectionDiagnostics {
  detector?: ScannerDetectorName;
  mode?: ScannerDetectionMode;
  processingMs?: number;
  candidateCount?: number;
  areaRatio?: number;
  meanEdgeCoverage?: number;
  minEdgeCoverage?: number;
  edgeCoverage?: [number, number, number, number];
  qualityPassAcceptable?: boolean;
  rawQuad?: QuadPoints | null;
  refinedQuad?: QuadPoints | null;
  fallbackReason?: string;
}

export interface ScanSession {
  id: string;
  empresa_id: string;
  created_by: string | null;
  context_type: string;
  context_id: string | null;
  target_field: string | null;
  status: ScanSessionStatus;
  token_hash: string;
  pin_code: string;
  expires_at: string;
  claimed_by_user_id: string | null;
  claimed_device_info: Record<string, unknown>;
  mobile_claim_token_hash: string | null;
  claimed_at: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  storage_bucket: string;
  storage_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  page_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface ScannedPage {
  id: string;
  originalDataUrl: string;
  quad: QuadPoints;
  processedDataUrl: string;
  filter: ScanFilter;
  width: number;
  height: number;
}

export interface CreateSessionOptions {
  contextType?: string;
  contextId?: string | null;
  targetField?: string | null;
  metadata?: Record<string, unknown>;
  ttlMinutes?: number;
}

export interface CreateSessionResult {
  session: ScanSession;
  token: string;
  joinUrl: string;
}

export interface ClaimSessionResult {
  session: ScanSession;
  token?: string;
  mobileClaimToken?: string;
}
