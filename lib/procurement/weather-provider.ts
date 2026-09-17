import type { Project } from "@/lib/types";

export const WEATHER_SOURCE = {
  DMH_OBSERVATION: "dmh-dinac",
  OPEN_METEO_MODEL: "open-meteo",
  LOCAL_RAIN_GAUGE: "LOCAL_RAIN_GAUGE",
} as const;

export type DailyWeatherObservation = {
  date: string;
  precipitation_mm: number;
  source: string;
  station_id: string | null;
  station_name: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  distance_km: number | null;
  observed_at: string | null;
  fallback_reason: string | null;
  raw_payload: Record<string, unknown> | null;
};

export interface WeatherProvider {
  getDailyWeather(project: Project, date: string): Promise<DailyWeatherObservation>;
}

type DmhStation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  precipitation_mm: number;
  observed_at: string | null;
  raw_station: unknown;
};

function coordinatesOf(project: Project) {
  const latitude = Number(project.latitude);
  const longitude = Number(project.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("La evaluación DMH requiere latitud y longitud de la obra.");
  }
  return { latitude, longitude };
}

function normalizeObservedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function haversineKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function numeric(value: unknown) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? value as JsonObject : {};
}

function readStation(id: string, value: unknown): DmhStation | null {
  const rawStation = object(value);
  const metadata = object(rawStation.metadatos ?? rawStation.metadata);
  const observation = object(rawStation.ultima_observacion ?? rawStation.last_observation);
  const precipitationData = object(observation.precipitacion ?? observation.precipitation);
  const observedData = object(observation.fecha);
  const precipitation = numeric(precipitationData.valor ?? precipitationData.value);
  const latitude = numeric(metadata.latitud ?? metadata.latitude);
  const longitude = numeric(metadata.longitud ?? metadata.longitude);
  if (precipitation === null || latitude === null || longitude === null) return null;
  return {
    id: String(metadata.codigo ?? metadata.code ?? id),
    name: String(metadata.nombre ?? metadata.name ?? id),
    latitude,
    longitude,
    precipitation_mm: Math.max(0, precipitation),
    observed_at: normalizeObservedAt(observedData.utc ?? observation.observed_at),
    raw_station: rawStation,
  };
}

export function selectNearestDmhStation(
  projectCoordinates: { latitude: number; longitude: number },
  stations: DmhStation[],
) {
  return stations
    .map((station) => ({ station, distance_km: haversineKm(projectCoordinates, station) }))
    .sort((a, b) => a.distance_km - b.distance_km || a.station.id.localeCompare(b.station.id))[0] ?? null;
}

export class DmhDinacWeatherProvider implements WeatherProvider {
  constructor(private readonly endpoint = "https://www.meteorologia.gov.py/emas/data.json") {}

  async getDailyWeather(project: Project, _date: string): Promise<DailyWeatherObservation> {
    const coordinates = coordinatesOf(project);
    const response = await fetch(this.endpoint, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`DMH/DINAC respondió HTTP ${response.status}.`);
    const payload = object(await response.json());
    const payloadObject = payload;
    const rawStations = payloadObject.estaciones ?? payloadObject.stations;
    const entries = Array.isArray(rawStations)
      ? rawStations.map((station: unknown, index: number) => [String(object(station).id ?? index), station] as const)
      : Object.entries(object(rawStations));
    const stations = entries
      .map(([id, station]) => readStation(String(id), station))
      .filter((station): station is DmhStation => station !== null);
    const selected = selectNearestDmhStation(coordinates, stations);
    if (!selected) throw new Error("El feed DMH/DINAC no tiene una estación válida para evaluar la obra.");
    return {
      date: _date,
      precipitation_mm: selected.station.precipitation_mm,
      source: WEATHER_SOURCE.DMH_OBSERVATION,
      station_id: selected.station.id,
      station_name: selected.station.name,
      coordinates: { latitude: selected.station.latitude, longitude: selected.station.longitude },
      distance_km: Number(selected.distance_km.toFixed(3)),
      observed_at: selected.station.observed_at,
      fallback_reason: null,
      raw_payload: payload,
    };
  }
}

export class OpenMeteoWeatherProvider implements WeatherProvider {
  constructor(private readonly endpoint = "https://api.open-meteo.com/v1/forecast") {}

  async getDailyWeather(project: Project, date: string): Promise<DailyWeatherObservation> {
    const { latitude, longitude } = coordinatesOf(project);
    const url = new URL(this.endpoint);
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("daily", "precipitation_sum");
    url.searchParams.set("start_date", date);
    url.searchParams.set("end_date", date);
    url.searchParams.set("timezone", "UTC");
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Open-Meteo respondió HTTP ${response.status}.`);
    const payload = object(await response.json());
    const payloadObject = payload;
    const daily = object(payloadObject.daily);
    const times = Array.isArray(daily.time) ? daily.time.filter((value): value is string => typeof value === "string") : [];
    const precipitationValues = Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum : [];
    const index = times.indexOf(date);
    const precipitation = numeric(precipitationValues[index]);
    if (index < 0 || precipitation === null) throw new Error("Open-Meteo no devolvió precipitación diaria válida.");
    return {
      date,
      precipitation_mm: Math.max(0, precipitation),
      source: WEATHER_SOURCE.OPEN_METEO_MODEL,
      station_id: null,
      station_name: null,
      coordinates: null,
      distance_km: null,
      observed_at: null,
      fallback_reason: null,
      raw_payload: payload,
    };
  }
}

export class UnsupportedWeatherProvider implements WeatherProvider {
  constructor(private readonly source: string) {}

  async getDailyWeather(): Promise<DailyWeatherObservation> {
    throw new Error(`La fuente climática "${this.source}" requiere una medición localmente verificada.`);
  }
}

export class ParaguayWeatherProvider implements WeatherProvider {
  constructor(
    private readonly dmh = new DmhDinacWeatherProvider(),
    private readonly openMeteo = new OpenMeteoWeatherProvider(),
  ) {}

  async getDailyWeather(project: Project, date: string) {
    try {
      return await this.dmh.getDailyWeather(project, date);
    } catch (dmhError) {
      const fallback = await this.openMeteo.getDailyWeather(project, date);
      const reason = dmhError instanceof Error ? dmhError.message : String(dmhError);
      return {
        ...fallback,
        fallback_reason: `Fallback desde DMH/DINAC: ${reason}`,
        raw_payload: {
          fallback_from: WEATHER_SOURCE.DMH_OBSERVATION,
          dmh_error: reason,
          open_meteo: fallback.raw_payload,
        },
      };
    }
  }
}

export function createWeatherProvider(source: string | null | undefined, project?: Project): WeatherProvider {
  const normalized = (source ?? WEATHER_SOURCE.DMH_OBSERVATION).trim().toLowerCase();
  if (normalized === WEATHER_SOURCE.DMH_OBSERVATION) return new ParaguayWeatherProvider();
  if (normalized === WEATHER_SOURCE.OPEN_METEO_MODEL) return new OpenMeteoWeatherProvider();
  return new UnsupportedWeatherProvider(project?.weather_source ?? normalized);
}
