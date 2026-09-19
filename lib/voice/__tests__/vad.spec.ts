import { describe, expect, it } from "vitest";
import { DEFAULT_VAD_CONFIG, VoiceActivityDetector, type VadEvent } from "../vad";

function runVAD(frames: Array<[rms: number, t: number]>) {
  const events: VadEvent[] = [];
  const vad = new VoiceActivityDetector(DEFAULT_VAD_CONFIG, (e) => events.push(e));
  for (const [rms, t] of frames) vad.process(rms, t);
  return { events, phase: vad.getPhase(), done: vad.isDone() };
}

const step = 50; // ms por frame
function silence(from: number, until: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let t = from; t < until; t += step) out.push([0.004, t]);
  return out;
}
function speech(from: number, until: number, rms = 0.12): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let t = from; t < until; t += step) out.push([rms, t]);
  return out;
}

describe("VoiceActivityDetector", () => {
  it("threshold: ruido bajo nunca dispara speech", () => {
    const { events, phase } = runVAD(silence(0, 3000));
    expect(events).toEqual([]);
    expect(phase).toBe("waiting_for_speech");
  });

  it("speech detected tras nivel estable ~150ms", () => {
    // 100ms sobre threshold no alcanza; 200ms sí.
    const short = runVAD(speech(0, 100));
    expect(short.events).toEqual([]);
    const ok = runVAD(speech(0, 250));
    expect(ok.events).toEqual(["speech_start"]);
    expect(ok.phase).toBe("speech_detected");
  });

  it("un pico aislado no dispara speech", () => {
    const frames: Array<[number, number]> = [...silence(0, 500), [0.3, 500], ...silence(550, 2000)];
    const { events } = runVAD(frames);
    expect(events).toEqual([]);
  });

  it("pausa corta entre palabras NO corta (silence < 1000ms)", () => {
    const frames = [...speech(0, 1000), ...silence(1000, 1600), ...speech(1600, 2500)];
    const { events, done } = runVAD(frames);
    expect(events).toEqual(["speech_start"]);
    expect(done).toBe(false);
  });

  it("silencio final ~1000ms SÍ corta (silence_stop, terminal)", () => {
    const frames = [...speech(0, 1000), ...silence(1000, 2500)];
    const { events, done } = runVAD(frames);
    expect(events).toEqual(["speech_start", "silence_stop"]);
    expect(done).toBe(true);
  });

  it("nunca habló → no_speech_timeout a los 8s, sin envío", () => {
    const { events, done } = runVAD(silence(0, 9000));
    expect(events).toEqual(["no_speech_timeout"]);
    expect(done).toBe(true);
  });

  it("habla tarde (antes del timeout) cancela el no_speech_timeout", () => {
    const frames = [...silence(0, 7000), ...speech(7000, 7300), ...silence(7300, 9000)];
    const { events } = runVAD(frames);
    expect(events).toEqual(["speech_start", "silence_stop"]);
    expect(events).not.toContain("no_speech_timeout");
  });

  it("eventos terminales disparan una sola vez (idempotencia)", () => {
    const frames = [...speech(0, 500), ...silence(500, 5000), ...speech(5000, 6000), ...silence(6000, 12000)];
    const { events } = runVAD(frames);
    expect(events.filter((e) => e === "silence_stop")).toHaveLength(1);
    expect(events.filter((e) => e === "speech_start")).toHaveLength(1);
  });
});
