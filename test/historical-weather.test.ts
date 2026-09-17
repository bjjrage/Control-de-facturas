import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  fetchHistoricalWeatherRange,
  parseHistoricalDailyPayload,
} from "../lib/procurement/weather-client";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - n * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

function monthPayload(dates: string[], mm: number[]) {
  return {
    latitude: -25.28,
    longitude: -57.64,
    daily: {
      time: dates,
      precipitation_sum: mm,
      precipitation_hours: mm.map((v) => (v > 0 ? 3 : 0)),
      temperature_2m_max: dates.map(() => 31),
      temperature_2m_min: dates.map(() => 22),
      wind_gusts_max_kmh: dates.map(() => 18),
      weathercode: dates.map(() => 0),
    },
  };
}

function enumerateRange(s: string, e: string): string[] {
  const dates: string[] = [];
  for (let d = new Date(`${s}T00:00:00Z`); d <= new Date(`${e}T00:00:00Z`); d = new Date(d.getTime() + 86400000)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

function utcToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// Mock que emula ambas APIs por URL (archive: fechas explícitas;
// forecast: past_days hasta ayer). mm determinista por día del mes.
function mockBothApis() {
  return vi.fn(async (rawUrl: string) => {
    const url = new URL(String(rawUrl));
    let dates: string[];
    if (url.hostname.includes("archive-api")) {
      dates = enumerateRange(url.searchParams.get("start_date")!, url.searchParams.get("end_date")!);
    } else {
      const n = Number(url.searchParams.get("past_days") || 7);
      dates = [];
      for (let i = n; i >= 1; i--) {
        dates.push(new Date(utcToday().getTime() - i * 86400000).toISOString().split("T")[0]);
      }
    }
    const mm = dates.map((d) => Number(d.slice(8, 10)) % 3);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => monthPayload(dates, mm),
    };
  });
}

// ---------------------------------------------------------------------------
// G. Rango mensual: una sola consulta, NO request por día
// ---------------------------------------------------------------------------
describe("G. Histórico por rango: una request mensual, nunca N+1", () => {
  it("un mes reciente = UNA sola llamada con past_days (sin fechas explícitas)", async () => {
    const start = isoDaysAgo(30);
    const end = isoDaysAgo(2);
    const fetchMock = mockBothApis();
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchHistoricalWeatherRange(-25.28, -57.64, start, end);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown[];
    const url = new URL(String(firstCall[0]));
    expect(url.hostname).toBe("api.open-meteo.com");
    expect(url.searchParams.get("past_days")).not.toBeNull();
    expect(url.searchParams.get("start_date")).toBeNull();
    expect(res.coveredDays).toBe(enumerateRange(start, end).length);
    expect(res.partialCoverage).toBe(false);
    expect(res.sources).toEqual(["open-meteo-past"]);
  });

  it("pasado remoto = UNA sola llamada al archive con fechas explícitas", async () => {
    const start = isoDaysAgo(150);
    const end = isoDaysAgo(120);
    const fetchMock = mockBothApis();
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchHistoricalWeatherRange(-25.28, -57.64, start, end);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown[];
    const url = new URL(String(firstCall[0]));
    expect(url.hostname).toBe("archive-api.open-meteo.com");
    expect(url.searchParams.get("start_date")).toBe(start);
    expect(url.searchParams.get("end_date")).toBe(end);
    expect(res.coveredDays).toBe(enumerateRange(start, end).length);
    expect(res.sources).toEqual(["open-meteo-archive"]);
  });

  it("rango que cruza el límite de 92 días: como máximo 2 llamadas disjuntas", async () => {
    const start = isoDaysAgo(120);
    const end = isoDaysAgo(10);
    const fetchMock = mockBothApis();
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchHistoricalWeatherRange(-25.28, -57.64, start, end);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    // Sin solapamiento: fechas únicas
    const got = res.observations.map((o) => o.date);
    expect(new Set(got).size).toBe(got.length);
    const urls = (fetchMock.mock.calls as unknown[]).map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("archive-api.open-meteo.com"))).toBe(true);
    expect(urls.some((u) => u.includes("api.open-meteo.com/v1/forecast"))).toBe(true);
  });

  it("payload 200 con {error:true} lanza en vez de devolver ceros silenciosos", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ error: true, reason: "Parameter 'past_days' is mutually exclusive" }),
      }))
    );
    await expect(fetchHistoricalWeatherRange(-25.28, -57.64, isoDaysAgo(10), isoDaysAgo(5))).rejects.toThrow(
      "mutually exclusive"
    );
  });
});

// ---------------------------------------------------------------------------
// H. Provider devuelve 0/12/4 mm → la UI recibe los datos correctos
// ---------------------------------------------------------------------------
describe("H. Mapeo por día: 0/12/4 mm con fuente honesta", () => {
  it("parsea cada día con su precipitación y fuente, sin tocar otros días", () => {
    const out = parseHistoricalDailyPayload(
      monthPayload(["2026-07-07", "2026-07-08", "2026-07-09"], [0, 12, 4]) as any,
      "2026-07-07",
      "2026-07-09",
      "open-meteo-archive"
    );
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({ date: "2026-07-07", precipitation_mm: 0 });
    expect(out[1]).toMatchObject({ date: "2026-07-08", precipitation_mm: 12 });
    expect(out[2]).toMatchObject({ date: "2026-07-09", precipitation_mm: 4 });
    expect(out.every((o) => o.source === "open-meteo-archive")).toBe(true);
  });

  it("respeta la invariante estricta de rango (nada fuera de [inicio, fin])", () => {
    const out = parseHistoricalDailyPayload(
      monthPayload(["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-31", "2026-08-01"], [9, 0, 5, 3, 8]) as any,
      "2026-07-01",
      "2026-07-31",
      "open-meteo-past"
    );
    expect(out.map((o) => o.date)).toEqual(["2026-07-01", "2026-07-02", "2026-07-31"]);
  });
});

// ---------------------------------------------------------------------------
// I. Consultar histórico NO inserta LL automáticamente (cero writes)
// ---------------------------------------------------------------------------
describe("I. Histórico es solo lectura: jamás escribe el Libro", () => {
  it("la action histórica no tiene ningún write (ni Libro ni clima ni batches)", () => {
    const src = readSource("app/(internal)/projects/historical-weather-actions.ts");
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain(".update(");
    expect(src).not.toContain(".upsert(");
    expect(src).not.toContain(".delete(");
    expect(src).not.toContain(".rpc(");
    // Ningún acceso real (query builder) a tablas de escritura
    expect(src).not.toContain('from("project_weather_log")');
    expect(src).not.toContain('from("climate_events")');
    expect(src).not.toContain('from("project_workday_status")');
    expect(src).not.toContain('from("climate_evidence")');
    expect(src).not.toContain('from("project_weather_forecast_batches")');
    expect(src).not.toContain('from("project_weather_forecast_snapshots")');
    // Solo lectura del proyecto para validar tenant + coordenadas
    expect(src).toContain('from("projects")');
    expect(src).toContain("fetchHistoricalWeatherRange");
  });
});

// ---------------------------------------------------------------------------
// J. "Usar como Lluvioso" explícito usa el mecanismo actual del Libro
// ---------------------------------------------------------------------------
describe("J. LL explícito reutiliza setWeatherDay (sin auto-escritura)", () => {
  it("la UI ofrece acción explícita por día que delega al Libro actual", () => {
    const ui = readSource("app/(internal)/projects/[id]/avance-fisico-panel.tsx");
    expect(ui).toContain("usar-como-ll");
    expect(ui).toContain("Usar como Lluvioso");
    // Delega en el mecanismo existente (persist → setWeatherDay), no escribe directo
    expect(ui).toContain("setWeatherDay");
  });
});

// ---------------------------------------------------------------------------
// K. Falla provider → mensaje claro, manual intacto, sin ceros inventados
// ---------------------------------------------------------------------------
describe("K. Fail cerrado histórico: sin datos inventados", () => {
  it("si el provider falla, el rango lanza (el llamador informa, no inventa)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(fetchHistoricalWeatherRange(-25.28, -57.64, isoDaysAgo(10), isoDaysAgo(5))).rejects.toThrow();
  });

  it("respuesta !ok también lanza en vez de devolver ceros", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, statusText: "Unavailable" })));
    await expect(fetchHistoricalWeatherRange(-25.28, -57.64, isoDaysAgo(10), isoDaysAgo(5))).rejects.toThrow("503");
  });

  it("la action y la UI muestran 'no disponibles' sin inventar 0 mm", () => {
    const action = readSource("app/(internal)/projects/historical-weather-actions.ts");
    expect(action).toContain("Datos meteorológicos no disponibles");
    const ui = readSource("app/(internal)/projects/[id]/avance-fisico-panel.tsx");
    expect(ui).toContain("Datos meteorológicos no disponibles");
    // Días sin dato quedan ausentes: el parser no rellena
    expect(parseHistoricalDailyPayload({} as any, "2026-07-01", "2026-07-31", "open-meteo-archive")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L. Weather Overlay futuro sin regresión
// ---------------------------------------------------------------------------
describe("L. El overlay futuro queda intacto", () => {
  it("la vía futura sigue siendo resolveWeeklyWeather (la histórica no la toca)", () => {
    const actions = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(actions).toContain("resolveWeeklyWeather");
    expect(actions).not.toContain("fetchHistoricalWeatherRange");
    expect(actions).not.toContain("getHistoricalWeatherAction");
    const hist = readSource("app/(internal)/projects/historical-weather-actions.ts");
    expect(hist).not.toContain("resolveWeeklyWeather");
    expect(hist).not.toContain("analyzeOperationalWorkability");
  });
});
