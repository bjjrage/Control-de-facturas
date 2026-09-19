import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSttSupported, startDictation, STT_MAX_RECORD_MS } from "../stt-client";

type FakeTrack = { stop: () => void; readyState: string };
type FakeStream = { getTracks: () => FakeTrack[] };

function makeTrack(): FakeTrack {
  return {
    readyState: "live",
    stop: vi.fn(function (this: FakeTrack) {
      this.readyState = "ended";
    }),
  };
}

function makeStream(): FakeStream {
  const tracks = [makeTrack()];
  return { getTracks: () => tracks };
}

type RecorderOpts = { mimeType?: string };
class FakeRecorder {
  static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static instances: FakeRecorder[] = [];
  static isTypeSupported(mime: string) {
    return FakeRecorder.supported.has(mime);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  startCalls = 0;
  stopCalls = 0;
  chunks: Blob[] = [];
  constructor(_stream: unknown, opts?: RecorderOpts) {
    this.mimeType = opts?.mimeType ?? "audio/webm";
    FakeRecorder.instances.push(this);
  }
  start() {
    this.startCalls += 1;
    this.state = "recording";
  }
  stop() {
    this.stopCalls += 1;
    this.state = "inactive";
    for (const c of this.chunks) this.ondataavailable?.({ data: c });
    this.onstop?.();
  }
  pushChunk(blob: Blob) {
    this.chunks.push(blob);
  }
}

// AudioContext falso con RMS controlable para VAD determinístico.
let fakeRms = 0;
class FakeAnalyser {
  fftSize = 512;
  getFloatTimeDomainData(array: Float32Array) {
    array.fill(fakeRms);
  }
  disconnect() {}
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static closedCount = 0;
  state = "running";
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  createMediaStreamSource(_stream: unknown) {
    return { connect: vi.fn(), disconnect: vi.fn() };
  }
  createAnalyser() {
    return new FakeAnalyser();
  }
  close() {
    this.state = "closed";
    FakeAudioContext.closedCount += 1;
    return Promise.resolve();
  }
}

// rAF manual + reloj fake (pasos explícitos, determinístico). Cada frame
// avanza 16.7ms para que los thresholds temporales del VAD funcionen.
let rafQueue: Array<() => void> = [];
let rafIdSeq = 0;
let fakeNow = 10000;
function stepRaf(frames: number) {
  for (let i = 0; i < frames; i += 1) {
    fakeNow += 16.7;
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb();
  }
}

const fetchSpy = vi.fn();
const getUserMediaMock = vi.fn();
let fakeStream: FakeStream;
let getUserMediaImpl: () => Promise<FakeStream>;

function installBrowserMocks() {
  fakeStream = makeStream();
  fakeRms = 0;
  getUserMediaImpl = () => Promise.resolve(fakeStream);
  getUserMediaMock.mockImplementation(() => getUserMediaImpl());
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: getUserMediaMock } });
  vi.stubGlobal("window", {});
  const w = window as unknown as Record<string, unknown>;
  w.MediaRecorder = FakeRecorder as unknown as typeof MediaRecorder;
  w.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  w.requestAnimationFrame = ((cb: () => void) => {
    rafIdSeq += 1;
    rafQueue.push(cb);
    return rafIdSeq;
  }) as typeof requestAnimationFrame;
  w.cancelAnimationFrame = ((_id: number) => {
    rafQueue = [];
  }) as typeof cancelAnimationFrame;
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("requestAnimationFrame", w.requestAnimationFrame);
  vi.stubGlobal("cancelAnimationFrame", w.cancelAnimationFrame);
}

function flush(ms = 0) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeRecorder.instances = [];
  FakeRecorder.supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  FakeAudioContext.instances = [];
  FakeAudioContext.closedCount = 0;
  rafQueue = [];
  fakeNow = 10000;
  fetchSpy.mockReset();
  installBrowserMocks();
  vi.spyOn(performance, "now").mockImplementation(() => fakeNow);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Rodrigo STT client (MediaRecorder + VAD)", () => {
  it("sin APIs de grabación reporta no soportado", async () => {
    vi.unstubAllGlobals();
    expect(isSttSupported()).toBe(false);
    const onError = vi.fn();
    const onEnd = vi.fn();
    const handle = startDictation({ onError, onEnd });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatch(/grabar audio/);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(() => {
      handle.stop();
      handle.cancel();
    }).not.toThrow();
    installBrowserMocks();
  });

  it("con APIs presentes reporta soportado e inicia grabación", async () => {
    expect(isSttSupported()).toBe(true);
    const onEnd = vi.fn();
    const onStarted = vi.fn();
    const handle = startDictation({ onEnd, onStarted });
    await flush();
    expect(FakeRecorder.instances).toHaveLength(1);
    expect(FakeRecorder.instances[0]?.startCalls).toBe(1);
    expect(FakeRecorder.instances[0]?.mimeType).toBe("audio/webm;codecs=opus");
    expect(getUserMediaMock).toHaveBeenCalledWith({ audio: true });
    expect(onStarted).toHaveBeenCalledTimes(1);
    expect(FakeAudioContext.instances).toHaveLength(1);
    handle.cancel();
  });

  it("permiso rechazado usa mensaje de permisos y limpia", async () => {
    getUserMediaImpl = () => {
      const e = new Error("denied") as Error & { name: string };
      e.name = "NotAllowedError";
      return Promise.reject(e);
    };
    const onError = vi.fn();
    const onEnd = vi.fn();
    startDictation({ onError, onEnd });
    await flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatch(/permisos del sitio/);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("sin dispositivo usa mensaje de micrófono ausente", async () => {
    getUserMediaImpl = () => {
      const e = new Error("none") as Error & { name: string };
      e.name = "NotFoundError";
      return Promise.reject(e);
    };
    const onError = vi.fn();
    startDictation({ onError, onEnd: vi.fn() });
    await flush();
    expect(onError.mock.calls[0]?.[0]).toMatch(/No se encontró un micrófono/);
  });

  it("stop() manual transcribe y llama onFinal + onEnd una vez, cerrando todo", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "Hola Rodrigo" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    const onFinal = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const onTranscribing = vi.fn();
    const handle = startDictation({ onFinal, onError, onEnd, onTranscribing });
    await flush();
    const rec = FakeRecorder.instances[0];
    expect(rec).toBeDefined();
    rec?.pushChunk(new Blob(["audio-bytes"], { type: "audio/webm;codecs=opus" }));
    handle.stop();
    await flush(20);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/agent/voice/transcribe");
    expect(init.method).toBe("POST");
    expect(init.body instanceof FormData).toBe(true);
    expect(onTranscribing).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal.mock.calls[0]?.[0]).toBe("Hola Rodrigo");
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    for (const t of fakeStream.getTracks()) {
      expect(t.stop).toHaveBeenCalled();
      expect(t.readyState).toBe("ended");
    }
    expect(FakeAudioContext.closedCount).toBe(1);
  });

  it("stop() doble + auto-stop en carrera envían UNA sola vez (idempotencia)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "hola" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    const onFinal = vi.fn();
    const handle = startDictation({ onFinal, onEnd: vi.fn(), onError: vi.fn() });
    await flush();
    FakeRecorder.instances[0]?.pushChunk(new Blob(["x"], { type: "audio/webm" }));
    handle.stop();
    handle.stop();
    handle.stop();
    await flush(20);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it("cancel() no POSTea, cierra AudioContext/tracks y solo llama onEnd", async () => {
    const onFinal = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const handle = startDictation({ onFinal, onError, onEnd });
    await flush();
    handle.cancel();
    await flush(20);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledTimes(1);
    for (const t of fakeStream.getTracks()) {
      expect(t.stop).toHaveBeenCalled();
    }
    expect(FakeAudioContext.closedCount).toBe(1);
  });

  it("audio vacío (sin chunks) reporta sin-audio sin POSTear", async () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    const handle = startDictation({ onError, onEnd, onFinal: vi.fn() });
    await flush();
    handle.stop();
    await flush(20);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0]).toMatch(/No se detectó audio/);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("transcript vacío del servidor reporta sin-audio", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "   " }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    const onError = vi.fn();
    const handle = startDictation({ onError, onEnd: vi.fn(), onFinal: vi.fn() });
    await flush();
    FakeRecorder.instances[0]?.pushChunk(new Blob(["x"], { type: "audio/webm" }));
    handle.stop();
    await flush(20);
    expect(onError.mock.calls[0]?.[0]).toMatch(/No se detectó audio/);
  });

  it("auto-stop a los 30s (STT_MAX_RECORD_MS)", async () => {
    expect(STT_MAX_RECORD_MS).toBe(30_000);
    vi.useFakeTimers();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "hola" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    const onFinal = vi.fn();
    startDictation({ onFinal, onEnd: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    FakeRecorder.instances[0]?.pushChunk(new Blob(["x"], { type: "audio/webm" }));
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(0);
    const rec = FakeRecorder.instances[0];
    expect(rec?.stopCalls).toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
  });

  it("VAD: habla -> speech_start, silencio 1s -> auto-stop y un solo envío", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ transcript: "Mostrame el presupuesto" }), {
        headers: { "Content-Type": "application/json" },
      })
    );
    const onFinal = vi.fn();
    const onSpeechStart = vi.fn();
    const onLevel = vi.fn();
    startDictation({ onFinal, onEnd: vi.fn(), onError: vi.fn(), onSpeechStart, onLevel });
    await flush();
    FakeRecorder.instances[0]?.pushChunk(new Blob(["voz"], { type: "audio/webm" }));
    // Silencio 1s (nada), luego voz 300ms -> speech_start, luego silencio 1.2s -> auto-stop.
    fakeRms = 0.004;
    stepRaf(60); // ~1s a 60fps
    expect(onSpeechStart).not.toHaveBeenCalled();
    fakeRms = 0.15;
    stepRaf(20); // ~330ms de voz
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    fakeRms = 0.004;
    stepRaf(80); // ~1.3s de silencio -> endpointing
    await flush(20);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal.mock.calls[0]?.[0]).toBe("Mostrame el presupuesto");
    expect(onLevel).toHaveBeenCalled();
  });

  it("VAD: pausa corta entre palabras NO corta", async () => {
    const onFinal = vi.fn();
    startDictation({ onFinal, onEnd: vi.fn(), onError: vi.fn() });
    await flush();
    fakeRms = 0.15;
    stepRaf(20);
    fakeRms = 0.004;
    stepRaf(30); // 500ms de pausa
    fakeRms = 0.15;
    stepRaf(20);
    await flush(10);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("VAD: nunca habló -> 'No te escuché', sin POST ni envío", async () => {
    const onFinal = vi.fn();
    const onError = vi.fn();
    startDictation({ onFinal, onError, onEnd: vi.fn() });
    await flush();
    fakeRms = 0.004;
    // Avanzar 9s en pasos (rAF manual) para superar noSpeechMs=8s.
    for (let i = 0; i < 9; i += 1) {
      stepRaf(60);
      await flush(0);
    }
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatch(/No te escuché/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onFinal).not.toHaveBeenCalled();
  });

  it("VAD: onLevel emite RMS real para waveform", async () => {
    const onLevel = vi.fn();
    const handle = startDictation({ onLevel, onEnd: vi.fn(), onError: vi.fn(), onFinal: vi.fn() });
    await flush();
    fakeRms = 0.2;
    stepRaf(5);
    expect(onLevel).toHaveBeenCalled();
    const last = onLevel.mock.calls[onLevel.mock.calls.length - 1]?.[0] as number;
    expect(last).toBeGreaterThan(0.1);
    fakeRms = 0.0;
    stepRaf(5);
    const lastSilent = onLevel.mock.calls[onLevel.mock.calls.length - 1]?.[0] as number;
    expect(lastSilent).toBeLessThan(0.05);
    handle.cancel();
  });
});
