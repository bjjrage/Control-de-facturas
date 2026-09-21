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

class ScannerDebugStore {
  private transitions: string[] = [];
  private cameraTelemetry: CameraDebugTelemetry = { ...initialCameraTelemetry };
  private listeners: Set<() => void> = new Set();

  public getTransitions(): string[] {
    return [...this.transitions];
  }

  public getCameraTelemetry(): CameraDebugTelemetry {
    return { ...this.cameraTelemetry };
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

  public resetCameraTelemetry() {
    this.cameraTelemetry = { ...initialCameraTelemetry };
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
 * Detecta si el modo debug está activo vía ?debug=1 o sessionStorage
 */
export function isScannerDebugActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1" || params.get("debug") === "true") {
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
