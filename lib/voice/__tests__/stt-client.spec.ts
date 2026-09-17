import { describe, expect, it, vi } from "vitest";
import { isSttSupported, startDictation } from "../stt-client";

describe("Rodrigo STT client", () => {
  it("sin SpeechRecognition reporta no soportado (node/test env)", () => {
    // En este entorno no hay window.SpeechRecognition: el cliente debe
    // decirlo en vez de romper. En el browser real usa la API nativa.
    expect(isSttSupported()).toBe(false);
  });

  it("startDictation sin soporte llama onError+onEnd y retorna stop noop", () => {
    const onError = vi.fn();
    const onEnd = vi.fn();
    const onFinal = vi.fn();
    const stop = startDictation({ onError, onEnd, onFinal });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onFinal).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
