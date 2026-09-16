import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";
import { deriveClimateForecastMetrics } from "@/lib/procurement/climate-metrics";
import {
  externalClimateMeasurementPatch,
  exceedsContractThreshold,
  localClimateMeasurementPatch,
} from "@/lib/procurement/climate-workdays";
import {
  DmhDinacWeatherProvider,
  OpenMeteoWeatherProvider,
  ParaguayWeatherProvider,
  UnsupportedWeatherProvider,
  WEATHER_SOURCE,
  selectNearestDmhStation,
} from "@/lib/procurement/weather-provider";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20260916220000_climate_workdays_final.sql"), "utf8");
const hardeningMigration = migration;
const actions = readFileSync(resolve(process.cwd(), "app/(internal)/projects/climate-actions.ts"), "utf8");
const runner = readFileSync(resolve(process.cwd(), "lib/procurement/climate-evaluation-runner.ts"), "utf8");

const project = {
  id: "project-a",
  latitude: -25.28,
  longitude: -57.64,
  weather_source: "dmh-dinac",
  weather_station_id: null,
  weather_station_name: null,
} as unknown as Project;

describe("climate workday domain", () => {
  it("lluvia mayor al umbral propone una jornada de lluvia", () => {
    expect(exceedsContractThreshold(21, 15)).toBe(true);
    expect(externalClimateMeasurementPatch(project, {
      date: "2026-09-14",
      precipitation_mm: 21,
      source: WEATHER_SOURCE.OPEN_METEO_MODEL,
      station_id: null,
      station_name: null,
      coordinates: null,
      distance_km: null,
      observed_at: null,
      fallback_reason: null,
      raw_payload: { rain: 21 },
    }, 15, null).status).toBe("PROPOSED");
  });

  it("lluvia menor al umbral no propone una pérdida", () => {
    expect(exceedsContractThreshold(14.9, 15)).toBe(false);
    expect(externalClimateMeasurementPatch(project, {
      date: "2026-09-14",
      precipitation_mm: 14.9,
      source: WEATHER_SOURCE.OPEN_METEO_MODEL,
      station_id: null,
      station_name: null,
      coordinates: null,
      distance_km: null,
      observed_at: null,
      fallback_reason: null,
      raw_payload: null,
    }, 15, null).status).toBe("OBSERVED");
  });

  it("mantiene externa y local simultáneamente cuando se repite la ingesta", () => {
    const patch = externalClimateMeasurementPatch(project, {
      date: "2026-09-14",
      precipitation_mm: 18,
      source: WEATHER_SOURCE.DMH_OBSERVATION,
      station_id: "station-1",
      station_name: "Asunción",
      coordinates: { latitude: -25.28, longitude: -57.64 },
      distance_km: 7.3,
      observed_at: "2026-09-14T12:00:00.000Z",
      fallback_reason: null,
      raw_payload: { precipitation: 18 },
    }, 15, {
      id: "event-1",
      local_precipitation_mm: 22,
      status: "CONFIRMED",
    } as never);
    expect(patch.external_precipitation_mm).toBe(18);
    expect(patch).not.toHaveProperty("local_precipitation_mm");
    expect(patch.status).toBe("CONFIRMED");
    expect(patch.threshold_exceeded).toBe(true);
    expect(patch.external_threshold_exceeded).toBe(true);
  });

  it("mantiene umbrales independientes sin MAX ni ganador implícito", () => {
    const patch = localClimateMeasurementPatch({
      contract_threshold_mm: 15,
      external_precipitation_mm: 3,
      threshold_exceeded: false,
    } as never, 22);
    expect(patch).toEqual({
      local_precipitation_mm: 22,
      local_threshold_exceeded: true,
      local_source: WEATHER_SOURCE.LOCAL_RAIN_GAUGE,
    });
    expect(hardeningMigration).toMatch(/external_threshold_exceeded boolean NOT NULL DEFAULT false/i);
    expect(hardeningMigration).toMatch(/local_threshold_exceeded boolean NOT NULL DEFAULT false/i);
    expect(hardeningMigration).toMatch(/threshold_exceeded = \(\s*external_precipitation_mm/i);
  });

  it("diferencia lluvia directa, efecto posterior y otras causas en el forecast", () => {
    const metrics = deriveClimateForecastMetrics({
      projectStartDate: "2026-09-01",
      asOfDate: "2026-09-04",
      workdays: [
        { work_date: "2026-09-02", classification: "NON_WORKABLE_RAIN", decision_status: "CONFIRMED" },
        { work_date: "2026-09-03", classification: "NON_WORKABLE_RAIN_EFFECT", decision_status: "CONFIRMED" },
        { work_date: "2026-09-04", classification: "NON_WORKABLE_OTHER", decision_status: "PROPOSED" },
      ],
      budgetItems: [{ start_date: "2026-09-01", end_date: "2026-09-02" }],
    });
    expect(metrics).toMatchObject({
      calendar_days_elapsed: 4,
      workable_days_elapsed: 2,
      rain_lost_days: 1,
      rain_effect_lost_days: 1,
      other_lost_days: 0,
      effective_available_days: 2,
      gross_schedule_variance: 2,
      weather_adjusted_variance: 0,
    });
  });
});

describe("weather provider boundary", () => {
  it("normaliza una respuesta diaria del provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ latitude: -25.28, longitude: -57.64, daily: { time: ["2026-09-14"], precipitation_sum: [22] } }),
    })));
    const result = await new OpenMeteoWeatherProvider().getDailyWeather(project, "2026-09-14");
    expect(result.precipitation_mm).toBe(22);
    expect(result.source).toBe(WEATHER_SOURCE.OPEN_METEO_MODEL);
    expect(result.coordinates).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("consulta el feed oficial DMH y selecciona la estación más cercana", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        estaciones: {
          far: {
            metadatos: { codigo: "FAR", nombre: "Lejana", latitud: -25.5, longitud: -57.8 },
            ultima_observacion: { fecha: { utc: "2026-09-14T12:00:00+0000", local: "2026-09-14T09:00:00-0300" }, precipitacion: { valor: 4.2 } },
          },
          near: {
            metadatos: { codigo: "NEAR", nombre: "Cercana", latitud: -25.29, longitud: -57.65 },
            ultima_observacion: { fecha: { utc: "2026-09-14T12:10:00+0000", local: "2026-09-14T09:10:00-0300" }, precipitacion: { valor: 18.4 } },
          },
        },
      }),
    })));
    const result = await new DmhDinacWeatherProvider("https://dmh.test/data.json").getDailyWeather(project, "2026-09-14");
    expect(result).toMatchObject({
      source: WEATHER_SOURCE.DMH_OBSERVATION,
      station_id: "NEAR",
      station_name: "Cercana",
      precipitation_mm: 18.4,
    });
    expect(result.distance_km).toBeCloseTo(1.5, 1);
    expect(result.raw_payload).toHaveProperty("estaciones");
    vi.unstubAllGlobals();
  });

  it("usa Open-Meteo únicamente como fallback cuando DMH no está disponible", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Unavailable" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ daily: { time: ["2026-09-14"], precipitation_sum: [22] } }),
      }));
    const result = await new ParaguayWeatherProvider().getDailyWeather(project, "2026-09-14");
    expect(result.source).toBe(WEATHER_SOURCE.OPEN_METEO_MODEL);
    expect(result.fallback_reason).toContain("DMH/DINAC");
    expect(result.raw_payload).toMatchObject({ fallback_from: WEATHER_SOURCE.DMH_OBSERVATION });
    vi.unstubAllGlobals();
  });

  it("usa Open-Meteo como fallback cuando el payload DMH es inválido", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ invalid: true }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ daily: { time: ["2026-09-14"], precipitation_sum: [7] } }),
      }));
    const result = await new ParaguayWeatherProvider().getDailyWeather(project, "2026-09-14");
    expect(result.source).toBe(WEATHER_SOURCE.OPEN_METEO_MODEL);
    expect(result.precipitation_mm).toBe(7);
    expect(result.fallback_reason).toContain("no tiene una estación válida");
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("ordena por distancia y desempata por ID de estación", () => {
    const selected = selectNearestDmhStation({ latitude: -25, longitude: -57 }, [
      { id: "B", name: "B", latitude: -25, longitude: -57, precipitation_mm: 1, observed_at: "2026-09-14T00:00:00.000Z", raw_station: null },
      { id: "A", name: "A", latitude: -25, longitude: -57, precipitation_mm: 2, observed_at: "2026-09-14T00:00:00.000Z", raw_station: null },
    ]);
    expect(selected?.station.id).toBe("A");
  });

  it("mantiene ausencia de coordenadas como error controlado", async () => {
    await expect(new DmhDinacWeatherProvider("https://dmh.test/data.json").getDailyWeather({} as Project, "2026-09-14"))
      .rejects.toThrow("latitud y longitud");
  });

  it("deja el modo manual detrás del boundary sin inventar una fuente externa", async () => {
    await expect(new UnsupportedWeatherProvider("manual").getDailyWeather()).rejects.toThrow("medición localmente");
  });
});

describe("migration and tenant safety audit", () => {
  it("mantiene como máximo un evento y una clasificación efectiva por fecha", () => {
    expect(migration).toMatch(/UNIQUE \(project_id, event_date\)/i);
    expect(migration).toMatch(/UNIQUE \(project_id, work_date\)/i);
  });

  it("conserva el vínculo causal de los efectos y protege el historial", () => {
    expect(migration).toMatch(/parent_workday_status_id\s+uuid REFERENCES public\.project_workday_status\(id\) ON DELETE RESTRICT/i);
    expect(migration).toMatch(/climate_event_id\s+uuid REFERENCES public\.climate_events\(id\) ON DELETE RESTRICT/i);
    expect(migration).toMatch(/classification <> 'NON_WORKABLE_RAIN_EFFECT' OR parent_workday_status_id IS NOT NULL/i);
  });

  it("endurece efectos, evidencia y Storage sin permitir reasignación física", () => {
    expect(hardeningMigration).toMatch(/v_parent_classification/);
    expect(hardeningMigration).toMatch(/v_parent_decision_status/);
    expect(hardeningMigration).toMatch(/NON_WORKABLE_RAIN[\s\S]*CONFIRMED/);
    expect(hardeningMigration).toMatch(/prevent_climate_evidence_mutation/);
    expect(hardeningMigration).toMatch(/La evidencia climática es inmutable/);
    expect(hardeningMigration).toMatch(/DROP POLICY IF EXISTS climate_evidence_delete/i);
    expect(hardeningMigration).toMatch(/storage\.foldername\(name\)\)\[2\] IS DISTINCT FROM 'climate'/i);
  });

  it("aplica RLS fail-closed por empresa a las tres entidades", () => {
    expect(migration).toMatch(/ALTER TABLE public\.climate_events ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.project_workday_status ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.climate_evidence ENABLE ROW LEVEL SECURITY/i);
    expect(migration.match(/empresa_id = public\.current_empresa_id\(\)/gi)?.length).toBeGreaterThanOrEqual(9);
  });

  it("no acepta rutas de evidencia de otro proyecto", () => {
    expect(actions).toMatch(/startsWith\(`\$\{input\.projectId\}\/climate\//);
    expect(migration).toMatch(/bucket existente|Storage existente/i);
  });

  it("persiste las métricas de forecast separando lluvia directa y efectos", () => {
    expect(migration).toMatch(/rain_lost_days integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/rain_effect_lost_days integer NOT NULL DEFAULT 0/i);
    expect(migration).toMatch(/weather_adjusted_variance numeric/i);
  });

  it("mantiene dos umbrales contractuales independientes por proyecto", () => {
    expect(migration).toMatch(/precipitation_threshold_mm numeric\(8,2\) NOT NULL DEFAULT 15/i);
    expect(actions).toMatch(/precipitationThresholdMm/);
  });

  it("preserva una confirmación humana en ejecuciones repetidas", () => {
    expect(actions).toMatch(/decision_status === "CONFIRMED"/);
    expect(migration).toMatch(/decision_status\s+text NOT NULL DEFAULT 'CONFIRMED'/i);
    expect(migration).toMatch(/proposed_automatically\s+boolean NOT NULL DEFAULT false/i);
  });

  it("no genera auditoría repetitiva cuando la ingesta es idempotente", () => {
    expect(runner).toMatch(/if \(result\.proposal_created \|\| result\.event_created \|\| result\.external_measurement_changed\)/);
  });
});
