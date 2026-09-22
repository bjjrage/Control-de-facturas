import type { DetectionDiagnostics } from './types';

/**
 * Debug Store y Telemetría en tiempo real para Control Scanner.
 * Registra transiciones de estado, eventos de hardware/cámara y mediciones del botón READY.
 * Ningún dato sensible (tokens, hashes, PINs) es almacenado ni mostrado.
 */

export interface CameraDebugTelemetry {
  mounted: boolean;
  startCameraCalled: boolean;
  isSecureContext: boolean;
  mediaDevicesPresent: boolean;
  getUserMediaPresent: boolean;
  getUserMediaRequestStarted: boolean;
  getUserMediaResult: string | null; // 'pending' | 'success' | 'error' | 'timeout'
  errorName: string | null;
  errorMessage: string | null;
  streamTracksCount: number;
  videoTrackState: string | null;
  videoTrackLabel: string | null;
  videoWidth: number;
  videoHeight: number;
  videoReadyState: number;
  loadedmetadataFired: boolean;
  canplayFired: boolean;
  playingFired: boolean;
  timeoutTriggered: boolean;
}

const initialCameraTelemetry: CameraDebugTelemetry = {
  mounted: false,
  startCameraCalled: false,
  isSecureContext: false,
  mediaDevicesPresent: false,
  getUserMediaPresent: false,
  getUserMediaRequestStarted: false,
  getUserMediaResult: null,
  errorName: null,
  errorMessage: null,
  streamTracksCount: 0,
  videoTrackState: null,
  videoTrackLabel: null,
  videoWidth: 0,
  videoHeight: 0,
  videoReadyState: 0,
  loadedmetadataFired: false,
  canplayFired: false,
  playingFired: false,
  timeoutTriggered: false,
};

export interface ScannerDetectionTelemetry {
  detector: 'v1' | 'v2' | 'unknown';
  opencvState: 'idle' | 'loading' | 'ready' | 'failed';
  processingMs: number;
  candidateCount: number;
  confidence: number;
  areaRatio: number;
  meanEdgeCoverage: number;
  minEdgeCoverage: number;
  mode: 'fast' | 'quality' | 'final' | 'idle';
  rawQuad: DetectionDiagnostics['rawQuad'];
  refinedQuad: DetectionDiagnostics['refinedQuad'];
  qualityPassAcceptable: boolean;
}

const initialDetectionTelemetry: ScannerDetectionTelemetry = {
  detector: 'unknown',
  opencvState: 'idle',
  processingMs: 0,
  candidateCount: 0,
  confidence: 0,
  areaRatio: 0,
  meanEdgeCoverage: 0,
  minEdgeCoverage: 0,
  mode: 'idle',
  rawQuad: null,
  refinedQuad: null,
  qualityPassAcceptable: false,
};

class ScannerDebugStore {
  private transitions: string[] = [];
  private cameraTelemetry: CameraDebugTelemetry = { ...initialCameraTelemetry };
  private detectionTelemetry: ScannerDetectionTelemetry = { ...initialDetectionTelemetry };
  private listeners: Set<() => void> = new Set();

  public getTransitions(): string[] {
    return [...this.transitions];
  }

  public getCameraTelemetry(): CameraDebugTelemetry {
    return { ...this.cameraTelemetry };
  }

  public getDetectionTelemetry(): ScannerDetectionTelemetry {
    return { ...this.detectionTelemetry };
  }

  public logTransition(entry: string) {
    const time = new Date().toTimeString().split(" ")[0];
    const item = `[${time}] ${entry}`;
    this.transitions = [...this.transitions.slice(-9), item];
    this.notify();
  }

  public updateCameraTelemetry(partial: Partial<CameraDebugTelemetry>) {
    this.cameraTelemetry = {
      ...this.cameraTelemetry,
      ...partial,
    };
    this.notify();
  }

  public updateDetectionTelemetry(partial: Partial<ScannerDetectionTelemetry>) {
    this.detectionTelemetry = {
      ...this.detectionTelemetry,
      ...partial,
    };
    this.notify();
  }

  public resetCameraTelemetry() {
    this.cameraTelemetry = { ...initialCameraTelemetry };
    this.notify();
  }

  public resetDetectionTelemetry() {
    this.detectionTelemetry = { ...initialDetectionTelemetry };
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.warn("Error notifying debug listener:", err);
      }
    });
  }
}

export const debugStore = new ScannerDebugStore();

/**
 * Detecta si el modo debug está activo vía ?debug=1, ?cvdebug=1 o sessionStorage
 */
export function isScannerDebugActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get("debug") === "1" ||
      params.get("debug") === "true" ||
      params.get("cvdebug") === "1" ||
      params.get("cvdebug") === "true"
    ) {
      sessionStorage.setItem("scanner_debug", "1");
      return true;
    }
    if (params.get("debug") === "0" || params.get("debug") === "false") {
      sessionStorage.removeItem("scanner_debug");
      return false;
    }
    return sessionStorage.getItem("scanner_debug") === "1";
  } catch {
    return false;
  }
}

export type ScannerDetectorPreference = 'auto' | 'v1' | 'v2';

export function getScannerDetectorPreference(): ScannerDetectorPreference {
  if (typeof window === 'undefined') return 'auto';
  const value = new URLSearchParams(window.location.search).get('detector');
  return value === 'v1' || value === 'v2' ? value : 'auto';
}
