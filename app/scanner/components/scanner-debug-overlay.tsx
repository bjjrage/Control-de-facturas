"use client";

import { useEffect, useState, RefObject } from "react";
import { debugStore, CameraDebugTelemetry } from "@/lib/scanner/debug-store";

interface ScannerDebugOverlayProps {
  flowState: string;
  sessionInfo: {
    id: string;
    context_type: string;
    status: string;
  } | null;
  readyButtonRef?: RefObject<HTMLButtonElement | null>;
}

export function ScannerDebugOverlay({
  flowState,
  sessionInfo,
  readyButtonRef,
}: ScannerDebugOverlayProps) {
  const [, setTick] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const handleUpdate = () => setTick((t) => t + 1);

    // Escuchar eventos de suscripción del store
    const unsubscribe = debugStore.subscribe(handleUpdate);

    // Escuchar eventos de layout y viewport
    window.addEventListener("resize", handleUpdate);
    window.addEventListener("orientationchange", handleUpdate);
    window.addEventListener("pageshow", handleUpdate);
    document.addEventListener("visibilitychange", handleUpdate);

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", handleUpdate);
      vv.addEventListener("scroll", handleUpdate);
    }

    const interval = setInterval(handleUpdate, 400);

    return () => {
      unsubscribe();
      window.removeEventListener("resize", handleUpdate);
      window.removeEventListener("orientationchange", handleUpdate);
      window.removeEventListener("pageshow", handleUpdate);
      document.removeEventListener("visibilitychange", handleUpdate);
      if (vv) {
        vv.removeEventListener("resize", handleUpdate);
        vv.removeEventListener("scroll", handleUpdate);
      }
      clearInterval(interval);
    };
  }, []);

  if (typeof window === "undefined") return null;

  // Mediciones de ventana y viewport
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  const docH = document.documentElement.clientHeight;
  const vvW = window.visualViewport?.width?.toFixed(1) ?? "N/A";
  const vvH = window.visualViewport?.height?.toFixed(1) ?? "N/A";
  const vvTop = window.visualViewport?.offsetTop?.toFixed(1) ?? "N/A";
  const ua = navigator.userAgent;
  const isSecure = typeof window.isSecureContext !== "undefined" ? window.isSecureContext : false;
  const hasMediaDevices = Boolean(navigator?.mediaDevices);
  const hasGetUserMedia = Boolean(navigator?.mediaDevices?.getUserMedia);

  // Mediciones del botón READY
  let buttonData: {
    top: number;
    bottom: number;
    height: number;
    display: string;
    visibility: string;
    opacity: string;
    pointerEvents: string;
    viewportBottom: number;
    isInside: boolean;
  } | null = null;

  if (readyButtonRef?.current) {
    const el = readyButtonRef.current;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    const vpBottom = window.visualViewport?.height ?? innerH;
    buttonData = {
      top: Math.round(rect.top * 10) / 10,
      bottom: Math.round(rect.bottom * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      viewportBottom: Math.round(vpBottom * 10) / 10,
      isInside: rect.bottom <= vpBottom,
    };
  }

  const transitions = debugStore.getTransitions();
  const cam = debugStore.getCameraTelemetry();

  return (
    <div
      className="fixed top-0 inset-x-0 z-[99998] bg-slate-950/95 text-yellow-300 font-mono text-[10px] leading-tight border-b-2 border-amber-500 shadow-2xl backdrop-blur-md select-text"
      style={{
        paddingTop: "max(0.5rem, env(safe-area-inset-top, 0px))",
      }}
    >
      <div className="flex items-center justify-between px-3 py-1 bg-amber-500/20 border-b border-amber-500/30">
        <span className="font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          DEBUG OVERLAY (?debug=1) · flow: <span className="text-white underline">{flowState}</span>
        </span>
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="px-2 py-0.5 rounded bg-amber-500/30 hover:bg-amber-500/50 text-amber-200 font-bold text-[9px]"
        >
          {isCollapsed ? "EXPANDIR ▲" : "COLAPSAR ▼"}
        </button>
      </div>

      {!isCollapsed && (
        <div className="p-3 max-h-[48vh] overflow-y-auto space-y-2 text-[10px]">
          {/* SECCIÓN 1: VIEWPORT & ENVIRONMENT */}
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 bg-slate-900/80 p-2 rounded border border-slate-800">
            <div>
              <span className="text-slate-400">innerSize:</span> {innerW}×{innerH}
            </div>
            <div>
              <span className="text-slate-400">docClientH:</span> {docH}
            </div>
            <div>
              <span className="text-slate-400">visualViewport:</span> {vvW}×{vvH}
            </div>
            <div>
              <span className="text-slate-400">vvOffsetTop:</span> {vvTop}
            </div>
            <div>
              <span className="text-slate-400">isSecureContext:</span>{" "}
              <span className={isSecure ? "text-emerald-400" : "text-red-400"}>{String(isSecure)}</span>
            </div>
            <div>
              <span className="text-slate-400">mediaDevices:</span>{" "}
              <span className={hasMediaDevices ? "text-emerald-400" : "text-red-400"}>
                {String(hasMediaDevices)}
              </span>
            </div>
            <div>
              <span className="text-slate-400">getUserMedia:</span>{" "}
              <span className={hasGetUserMedia ? "text-emerald-400" : "text-red-400"}>
                {String(hasGetUserMedia)}
              </span>
            </div>
            <div>
              <span className="text-slate-400">sessionStatus:</span>{" "}
              <span className="text-emerald-300">{sessionInfo?.status || "null"}</span>
            </div>
            <div className="col-span-2 truncate text-[9px]">
              <span className="text-slate-400">sessionId:</span> {sessionInfo?.id || "null"}
            </div>
            <div className="col-span-2 truncate text-[8px] text-slate-500">
              <span className="text-slate-400">UA:</span> {ua}
            </div>
          </div>

          {/* SECCIÓN 2: READY BUTTON BOUNDING RECT */}
          <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
            <div className="font-bold text-amber-200 border-b border-slate-800 pb-0.5 mb-1">
              READY BUTTON TELEMETRY:
            </div>
            {buttonData ? (
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span>
                    top: {buttonData.top}px | bottom: {buttonData.bottom}px | h: {buttonData.height}px
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>
                    disp: {buttonData.display} | vis: {buttonData.visibility} | op: {buttonData.opacity}
                  </span>
                  <span>ptr: {buttonData.pointerEvents}</span>
                </div>
                <div className="flex justify-between font-bold pt-0.5">
                  <span>viewportBottom: {buttonData.viewportBottom}px</span>
                  <span
                    className={
                      buttonData.isInside
                        ? "text-emerald-400 bg-emerald-950/60 px-1 rounded border border-emerald-700"
                        : "text-red-400 bg-red-950/60 px-1 rounded border border-red-700"
                    }
                  >
                    bottom &lt;= vpBottom: {buttonData.isInside ? "YES (INSIDE)" : "NO (CLIPPED)"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="text-slate-400 italic">
                {flowState === "ready"
                  ? "Buscando referencia del botón en DOM..."
                  : `Botón inactivo en flowState='${flowState}'`}
              </div>
            )}
          </div>

          {/* SECCIÓN 3: TRANSITIONS LOG */}
          <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
            <div className="font-bold text-amber-200 border-b border-slate-800 pb-0.5 mb-1">
              TRANSICIONES (Últimas 10):
            </div>
            <div className="space-y-0.5">
              {transitions.length > 0 ? (
                transitions.map((t, idx) => (
                  <div key={idx} className="truncate text-[9px] text-amber-300/90 font-mono">
                    {t}
                  </div>
                ))
              ) : (
                <div className="text-slate-500 italic">Sin transiciones registradas</div>
              )}
            </div>
          </div>

          {/* SECCIÓN 4: CAMERA TELEMETRY */}
          <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
            <div className="font-bold text-amber-200 border-b border-slate-800 pb-0.5 mb-1 flex justify-between">
              <span>CAMERA CAPTURE TELEMETRY:</span>
              <span className={cam.mounted ? "text-emerald-400" : "text-slate-500"}>
                {cam.mounted ? "MOUNTED" : "UNMOUNTED"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <div>
                <span className="text-slate-400">startCamera:</span> {String(cam.startCameraCalled)}
              </div>
              <div>
                <span className="text-slate-400">reqStarted:</span> {String(cam.getUserMediaRequestStarted)}
              </div>
              <div>
                <span className="text-slate-400">result:</span>{" "}
                <span
                  className={
                    cam.getUserMediaResult === "success"
                      ? "text-emerald-400"
                      : cam.getUserMediaResult === "pending"
                      ? "text-yellow-400"
                      : "text-red-400"
                  }
                >
                  {cam.getUserMediaResult || "none"}
                </span>
              </div>
              <div>
                <span className="text-slate-400">tracks:</span> {cam.streamTracksCount} (
                {cam.videoTrackState || "none"})
              </div>
              {cam.errorName && (
                <div className="col-span-2 text-red-300 bg-red-950/60 p-1 rounded">
                  <span className="font-bold">{cam.errorName}:</span> {cam.errorMessage}
                </div>
              )}
              <div>
                <span className="text-slate-400">trackLabel:</span>{" "}
                <span className="truncate inline-block max-w-[120px] align-bottom">
                  {cam.videoTrackLabel || "none"}
                </span>
              </div>
              <div>
                <span className="text-slate-400">videoDim:</span> {cam.videoWidth}×{cam.videoHeight}
              </div>
              <div>
                <span className="text-slate-400">videoReady:</span> state {cam.videoReadyState}
              </div>
              <div>
                <span className="text-slate-400">events:</span>{" "}
                {cam.loadedmetadataFired ? "meta✓" : "meta-"} {cam.canplayFired ? "can✓" : "can-"}{" "}
                {cam.playingFired ? "play✓" : "play-"}
              </div>
              {cam.timeoutTriggered && (
                <div className="col-span-2 text-amber-400 font-bold bg-amber-950/60 p-1 rounded">
                  ⚠ Camera initialization timeout (&gt;8s) triggered
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
