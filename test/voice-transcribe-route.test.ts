import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireProfile } = vi.hoisted(() => ({
  mockRequireProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireProfile: mockRequireProfile }));

import { POST } from "@/app/api/agent/voice/transcribe/route";

const PROFILE = { id: "user-1", empresa_id: "emp-T" };
const SAVED_OPENAI = process.env.OPENAI_API_KEY;
const fetchSpy = vi.fn();

function audioRequest(file: unknown) {
  const form = new FormData();
  if (file instanceof Blob) {
    form.append("audio", file, "audio.webm");
  } else if (typeof file === "string") {
    form.append("audio", file);
  }
  return new Request("http://localhost/api/agent/voice/transcribe", {
    method: "POST",
    body: form,
  });
}

function webmBytes(size: number, type = "audio/webm;codecs=opus") {
  return new File([new Uint8Array(size)], "audio.webm", { type });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = "test-openai-key";
  mockRequireProfile.mockResolvedValue(PROFILE);
  vi.stubGlobal("fetch", fetchSpy);
  fetchSpy.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (SAVED_OPENAI === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = SAVED_OPENAI;
});

describe("POST /api/agent/voice/transcribe", () => {
  it("401 sin perfil autenticado", async () => {
    mockRequireProfile.mockRejectedValue(new Error("redirect"));
    const res = await POST(audioRequest(webmBytes(100)));
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400 sin archivo de audio", async () => {
    const res = await POST(new Request("http://localhost/api/agent/voice/transcribe", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("400 con audio vacío (0 bytes)", async () => {
    const res = await POST(audioRequest(webmBytes(0)));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("413 con archivo mayor a 8 MB", async () => {
    const res = await POST(audioRequest(webmBytes(8 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("415 con MIME inválido", async () => {
    const bad = new File([new Uint8Array(100)], "x.txt", { type: "text/plain" });
    const form = new FormData();
    form.append("audio", bad, "x.txt");
    const res = await POST(new Request("http://localhost/api/agent/voice/transcribe", { method: "POST", body: form }));
    expect(res.status).toBe(415);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("502 si OpenAI falla (HTTP error)", async () => {
    fetchSpy.mockResolvedValue(new Response("upstream error", { status: 500 }));
    const res = await POST(audioRequest(webmBytes(1000)));
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/transcribir/i);
  });

  it("502 si OpenAI no responde (network)", async () => {
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    const res = await POST(audioRequest(webmBytes(1000)));
    expect(res.status).toBe(502);
  });

  it("422 si el transcript viene vacío", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ text: "   " }), { headers: { "Content-Type": "application/json" } })
    );
    const res = await POST(audioRequest(webmBytes(1000)));
    expect(res.status).toBe(422);
  });

  it("200 con transcript y llamada correcta a OpenAI (sin exponer key)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ text: "Hola Rodrigo" }), { headers: { "Content-Type": "application/json" } })
    );
    const res = await POST(audioRequest(webmBytes(1000)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transcript: string };
    expect(body.transcript).toBe("Hola Rodrigo");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(url).not.toContain("test-openai-key");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-openai-key");
    const sent = init.body as FormData;
    expect(sent.get("model")).toBe("gpt-transcribe");
    const sentFile = sent.get("file");
    expect(sentFile instanceof Blob).toBe(true);
    // La key viaja SOLO en el header Authorization server->OpenAI (requerido);
    // nunca en URL ni en los campos del body.
    expect(url).not.toContain("test-openai-key");
    for (const [, value] of sent.entries()) {
      if (typeof value === "string") expect(value).not.toContain("test-openai-key");
    }
  });

  it("503 si falta OPENAI_API_KEY (fail-closed, sin llamar a OpenAI)", async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(audioRequest(webmBytes(1000)));
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
