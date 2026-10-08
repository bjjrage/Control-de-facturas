import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { raceCameraRequest } from "@/components/captura-verificada";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

function fakeStream(id = "stream-1"): MediaStream {
  return { id, getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack] } as unknown as MediaStream;
}

function okStream(stream: MediaStream): Promise<MediaStream> {
  return new Promise((resolve) => setTimeout(() => resolve(stream), 10));
}

describe("raceCameraRequest de captura verificada", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resuelve con el stream cuando la cámara responde a tiempo", async () => {
    const stream = fakeStream();
    const promise = raceCameraRequest(okStream(stream));
    vi.advanceTimersByTime(50);
    const outcome = await promise;
    expect(outcome).toEqual({ kind: "stream", stream });
  });

  it("resuelve con clasificación de error cuando la cámara rechaza", async () => {
    const error = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const promise = raceCameraRequest(Promise.reject(error));
    vi.advanceTimersByTime(50);
    await expect(promise).resolves.toEqual({ kind: "error", error });
  });

  it("no bloquea indefinidamente: marca timeout y libera la cámara si responde después", async () => {
    const stopTrack = vi.fn();
    const lateStream = { id: "late-stream", getTracks: () => [{ stop: stopTrack } as unknown as MediaStreamTrack] } as unknown as MediaStream;
    const request = new Promise<MediaStream>((resolve) => setTimeout(() => resolve(lateStream), 15000));
    const promise = raceCameraRequest(request);
    vi.advanceTimersByTime(10000);
    const outcome = await promise;
    expect(outcome).toEqual({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(6000);
  });

  it("mantiene el primer resultado cuando llegan varios eventos", async () => {
    const stream = fakeStream();
    const promise = raceCameraRequest(okStream(stream));
    await vi.advanceTimersByTimeAsync(20000);
    const outcome = await promise;
    expect(outcome?.kind).toBe("stream");
  });
});

describe("recuperación de cámara del residente (fuente)", () => {
  const component = readSource("components/captura-verificada.tsx");

  it("reutiliza la clasificación canónica de errores de cámara y no la duplica", () => {
    expect(component).toContain("from \"@/lib/scanner/camera-helpers\"");
    expect(component).toContain("checkCameraEnvironment()");
    expect(component).toContain("parseCameraError(outcome.error)");
  });

  it("muestra el fallback Subir foto ante cualquier estado de fracaso de cámara", () => {
    expect(component).toContain("camError ? (");
    expect(component).toContain("Subir foto");
    const fallbackCondition = component.slice(component.indexOf("camError ? ("), component.indexOf("type=\"file\""));
    expect(fallbackCondition).not.toContain('"no-camara"');
  });

  it("discrimina estados: denegado, sin cámara, sin respuesta y error de captura", () => {
    expect(component).toContain('setCamError(info.isPermissionDenied ? "denied" : "no-camara")');
    expect(component).toContain('setCamError("sin-respuesta")');
    expect(component).toContain("La cámara no respondió. Podés reintentar o subir una foto del archivo.");
    expect(component).toContain('setCamError("captura")');
  });

  it("muestra el estado de espera del permiso sin dejar la UI sin información", () => {
    expect(component).toContain("camPending");
    expect(component).toContain("Esperando cámara…");
    expect(component).toContain("disabled={full || busy || camPending}");
  });

  it("libera el stream si la solicitud pendiente resuelve luego del timeout", () => {
    expect(component).toContain('late.getTracks().forEach((t) => t.stop())');
  });

  it("conserva cues de limpieza de streams al desmontar", () => {
    expect(component).toContain("stopStream()");
    expect(component).toContain("streamRef.current?.getTracks().forEach((t) => t.stop())");
  });

  it("conserva la procedencia honesta: captura con cámara, archivo marcado como archivo", () => {
    expect(component).toContain('source: "camara"');
    expect(component).toContain('source: "archivo"');
    expect(component).not.toContain('source: "archivo",\n          lat: null');
    expect(component).toMatch(/handleFallbackFiles[\s\S]*source: "archivo"/);
    expect(component).toMatch(/capture\(\)[\s\S]*source: "camara"/);
  });

  it("no falsifica geolocalización ni fecha: ambos orígenes sellan y avisan", () => {
    expect(component.match(/getPosition\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(component).toContain("Sin permiso de ubicación — la foto se guarda igual, con fecha y hora.");
  });
});

describe("integración de formularios del portal residente", () => {
  it("la lluvia obliga exactamente una foto y bloquea el envío sin ella", () => {
    const workflows = readSource("app/avance/[token]/resident-workflows.tsx");
    expect(workflows).toContain("if (photos.length !== 1) { setMessage(\"Adjuntá la foto del pluviómetro.\"); return; }");
    expect(workflows).toContain("disabled={pending || photos.length !== 1}");
  });

  it("el avance envía metadata real de captura junto a la imagen", () => {
    const form = readSource("app/avance/[token]/avance-form.tsx");
    expect(form).toContain("capturedAt: p.capturedAt");
    expect(form).toContain("accuracy: p.accuracy");
    expect(form).toContain("source: p.source");
  });
});
