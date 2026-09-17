import { DailyWeatherForecast } from "@/lib/types";

export interface OpenMeteoDailyResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  daily?: {
    time: string[];
    precipitation_sum?: number[];
    precipitation_hours?: number[];
    precipitation_probability_max?: number[];
    wind_gusts_10m_max?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    weathercode?: number[];
  };
}

/**
 * Fetch daily weather forecast from Open-Meteo API.
 * Free, non-commercial use, requires no API key.
 * 
 * @param latitude Latitude in decimal degrees (e.g. -25.2867)
 * @param longitude Longitude in decimal degrees (e.g. -57.6470)
 * @param forecastDays Number of days to forecast (max 16 for standard, default 14)
 */
export async function fetchWeatherForecast(
  latitude: number,
  longitude: number,
  forecastDays: number = 14
): Promise<DailyWeatherForecast[]> {
  const days = Math.min(Math.max(1, forecastDays), 16);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set(
    "daily",
    "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_gusts_10m_max"
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", days.toString());

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    // Cache for 2 hours to avoid spamming
    next: { revalidate: 7200 },
  });

  if (!res.ok) {
    throw new Error(
      `Error al consultar Open-Meteo API (${res.status}): ${res.statusText}`
    );
  }

  const data: OpenMeteoDailyResponse = await res.json();
  if (!data.daily || !data.daily.time) {
    return [];
  }

  const result: DailyWeatherForecast[] = [];
  for (let i = 0; i < data.daily.time.length; i++) {
    result.push({
      date: data.daily.time[i],
      precipitation_sum_mm: data.daily.precipitation_sum?.[i] ?? 0,
      precipitation_hours: data.daily.precipitation_hours?.[i] ?? 0,
      precipitation_probability_max:
        data.daily.precipitation_probability_max?.[i] ?? 0,
      wind_gusts_max_kmh: data.daily.wind_gusts_10m_max?.[i] ?? 0,
      temperature_max_c: data.daily.temperature_2m_max?.[i],
      temperature_min_c: data.daily.temperature_2m_min?.[i],
      weather_code: data.daily.weathercode?.[i] ?? 0,
    });
  }

  return result;
}

/**
 * Fetch daily weather forecast for an exact date range [startDate, endDate] from Open-Meteo.
 * Clamps to provider's supported horizon (today .. today + 15 days) without fabricating missing days.
 */
export async function fetchWeatherForecastRange(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string
): Promise<{ forecasts: DailyWeatherForecast[]; partialCoverage: boolean; requestedDays: number; coveredDays: number }> {
  const reqStart = new Date(`${startDate}T00:00:00Z`);
  const reqEnd = new Date(`${endDate}T00:00:00Z`);

  if (reqEnd < reqStart) {
    throw new Error(`Rango inválido: endDate (${endDate}) es anterior a startDate (${startDate}).`);
  }

  const requestedDays = Math.max(1, Math.round((reqEnd.getTime() - reqStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  // Open-Meteo forecast horizon limits: from 92 days past up to 16 days in the future
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const maxProviderDate = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000); // 16 days inclusive

  // Effective clamped dates
  const effectiveStart = reqStart < today ? today : reqStart;
  const effectiveEnd = reqEnd > maxProviderDate ? maxProviderDate : reqEnd;

  if (effectiveEnd < effectiveStart) {
    // Requested range is completely outside provider's available forecast horizon
    return {
      forecasts: [],
      partialCoverage: true,
      requestedDays,
      coveredDays: 0,
    };
  }

  const startStr = effectiveStart.toISOString().split("T")[0];
  const endStr = effectiveEnd.toISOString().split("T")[0];

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set(
    "daily",
    "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,precipitation_probability_max,wind_gusts_10m_max"
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("start_date", startStr);
  url.searchParams.set("end_date", endStr);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 7200 },
  });

  if (!res.ok) {
    throw new Error(
      `Error al consultar Open-Meteo API (${res.status}): ${res.statusText}`
    );
  }

  const data: OpenMeteoDailyResponse = await res.json();
  if (!data.daily || !data.daily.time) {
    return {
      forecasts: [],
      partialCoverage: true,
      requestedDays,
      coveredDays: 0,
    };
  }

  const forecasts: DailyWeatherForecast[] = [];
  for (let i = 0; i < data.daily.time.length; i++) {
    const d = data.daily.time[i];
    // Strict invariant: no forecast_date < startDate or > endDate
    if (d >= startDate && d <= endDate) {
      forecasts.push({
        date: d,
        precipitation_sum_mm: data.daily.precipitation_sum?.[i] ?? 0,
        precipitation_hours: data.daily.precipitation_hours?.[i] ?? 0,
        precipitation_probability_max:
          data.daily.precipitation_probability_max?.[i] ?? 0,
        wind_gusts_max_kmh: data.daily.wind_gusts_10m_max?.[i] ?? 0,
        temperature_max_c: data.daily.temperature_2m_max?.[i],
        temperature_min_c: data.daily.temperature_2m_min?.[i],
        weather_code: data.daily.weathercode?.[i] ?? 0,
      });
    }
  }

  const coveredDays = forecasts.length;
  const partialCoverage = coveredDays < requestedDays;

  return {
    forecasts,
    partialCoverage,
    requestedDays,
    coveredDays,
  };
}

/**
 * Maps WMO weather codes to human-readable Spanish descriptions.
 */
export function describeWeatherCode(code: number): string {
  switch (code) {
    case 0:
      return "Despejado";
    case 1:
    case 2:
    case 3:
      return "Parcialmente nublado";
    case 45:
    case 48:
      return "Niebla";
    case 51:
    case 53:
    case 55:
      return "Llovizna leve a moderada";
    case 61:
    case 63:
    case 65:
      return "Lluvia persistente";
    case 71:
    case 73:
    case 75:
      return "Nevada";
    case 80:
    case 81:
    case 82:
      return "Chubascos fuertes";
    case 95:
      return "Tormenta eléctrica";
    case 96:
    case 99:
      return "Tormenta con granizo";
    default:
      return "Condición climática variable";
  }
}

export const MISSING_PROJECT_LOCATION_MSG =
  "El proyecto no tiene una ubicación geográfica configurada. Configurá latitud y longitud para consultar clima histórico.";

/**
 * P1-2: coordenadas válidas para evidencia histórica contractual.
 * null/undefined/""/NaN/Infinity o fuera de rango → inválidas.
 * (0,0 es rango válido pero nunca llega como default: sin dato se rechaza.)
 */
export function isValidProjectCoords(latitude: unknown, longitude: unknown): boolean {
  if (latitude === null || latitude === undefined || latitude === "") return false;
  if (longitude === null || longitude === undefined || longitude === "") return false;
  const lat = typeof latitude === "string" ? Number(latitude) : (latitude as number);
  const lon = typeof longitude === "string" ? Number(longitude) : (longitude as number);
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// ---------------------------------------------------------------------------
// Clima HISTÓRICO observado (Libro de Obra) — contexto DISTINTO del overlay
// de pronóstico futuro. Solo fechas pasadas (< hoy), mismo ecosistema
// Open-Meteo pero con la API apropiada para historia:
// - Pasado remoto: Archive API (ERA5), una request por rango.
// - Pasado reciente (hasta 92 días, documentado por el provider): Forecast
//   API con past_days explícito, una request por rango.
// - Rango que cruza el límite: 2 requests disjuntas como máximo.
// NUNCA una request por día (no N+1). Sin persistencia. Sin invención: los
// días sin dato quedan AUSENTES (nunca 0 mm fabricado).
// ---------------------------------------------------------------------------

export type HistoricalWeatherSource = "open-meteo-archive" | "open-meteo-past";

export interface DailyObservedWeather {
  date: string; // YYYY-MM-DD
  precipitation_mm: number;
  precipitation_hours: number | null;
  temperature_max_c: number | null;
  temperature_min_c: number | null;
  wind_gusts_max_kmh: number | null;
  weather_code: number | null;
  source: HistoricalWeatherSource;
}

// P1-1: variables separadas por endpoint. El Archive API NO ofrece
// precipitation_probability_max como daily (la devuelve null); pedirla es
// incorrecto aunque hoy no dé 400. Solo se piden variables soportadas y
// realmente consumidas por el parser/UI.
const HISTORICAL_ARCHIVE_DAILY_VARS =
  "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,wind_gusts_10m_max";
const HISTORICAL_FORECAST_DAILY_VARS =
  "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_hours,wind_gusts_10m_max";

/** El provider documenta pasado hasta 92 días en la API de forecast. */
const FORECAST_PAST_LIMIT_DAYS = 92;

const DAY_MS = 1000 * 60 * 60 * 24;

function toUtcDay(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}
function isoDay(d: Date): string {
  return d.toISOString().split("T")[0];
}

/**
 * Parser puro y testeable: convierte el payload daily (forecast o archive,
 * mismo shape) en observaciones, con invariante estricta de rango.
 *
 * P2-1: dato ausente ≠ día seco. Solo se emite el día si el provider entregó
 * un precipitation_sum numérico finito (incluido el 0 explícito). Si el array
 * no existe, el índice falta, es null o no es finito, el día SE OMITE (nunca
 * se fabrica "0 mm").
 */
export function parseHistoricalDailyPayload(
  data: OpenMeteoDailyResponse,
  startDate: string,
  endDate: string,
  source: HistoricalWeatherSource
): DailyObservedWeather[] {
  const out: DailyObservedWeather[] = [];
  if (!data || !data.daily || !data.daily.time) return out;
  const sums = data.daily.precipitation_sum;
  for (let i = 0; i < data.daily.time.length; i++) {
    const d = data.daily.time[i];
    // Invariante estricta: nada fuera del rango pedido.
    if (d < startDate || d > endDate) continue;
    const raw = Array.isArray(sums) ? sums[i] : undefined;
    // Evidencia mínima válida: número finito (0 explícito vale, null no).
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    out.push({
      date: d,
      precipitation_mm: raw,
      precipitation_hours: data.daily.precipitation_hours?.[i] ?? null,
      temperature_max_c: data.daily.temperature_2m_max?.[i] ?? null,
      temperature_min_c: data.daily.temperature_2m_min?.[i] ?? null,
      wind_gusts_max_kmh: data.daily.wind_gusts_10m_max?.[i] ?? null,
      weather_code: data.daily.weathercode?.[i] ?? null,
      source,
    });
  }
  return out;
}

async function fetchHistoricalSlice(
  apiBase: string,
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
  dailyVars: string,
  extraParams: Record<string, string>,
  source: HistoricalWeatherSource
): Promise<DailyObservedWeather[]> {
  const url = new URL(apiBase);
  url.searchParams.set("latitude", latitude.toFixed(4));
  url.searchParams.set("longitude", longitude.toFixed(4));
  url.searchParams.set("daily", dailyVars);
  url.searchParams.set("timezone", "auto");
  // NOTA: past_days es mutuamente excluyente con start_date/end_date en la
  // API de forecast: cuando se usa past_days NO se envían fechas explícitas
  // (el parser filtra al rango pedido igualmente).
  if (!("past_days" in extraParams)) {
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
  }
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    next: { revalidate: 86400 }, // historia observada: cacheable 24h
  });

  if (!res.ok) {
    throw new Error(
      `Error al consultar histórico Open-Meteo (${res.status}): ${res.statusText}`
    );
  }

  const data: OpenMeteoDailyResponse = await res.json();
  // La API puede responder 200 con {error:true} (ej. parámetros inválidos):
  // lanzar en vez de devolver ceros silenciosos.
  if ((data as unknown as { error?: boolean }).error === true) {
    throw new Error(
      `Histórico Open-Meteo rechazado: ${(data as unknown as { reason?: string }).reason || "parámetros inválidos"}`
    );
  }
  return parseHistoricalDailyPayload(data, startDate, endDate, source);
}

/**
 * Clima observado en [startDate, endDate]. Solo pasado (< hoy UTC): los días
 * futuros quedan fuera (aún no observados) y cuentan como no cubiertos.
 * Lanza en fallo del provider (el llamador informa "no disponible" sin
 * inventar ceros).
 */
export async function fetchHistoricalWeatherRange(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string
): Promise<{
  observations: DailyObservedWeather[];
  partialCoverage: boolean;
  requestedDays: number;
  coveredDays: number;
  sources: HistoricalWeatherSource[];
}> {
  const reqStart = new Date(`${startDate}T00:00:00Z`);
  const reqEnd = new Date(`${endDate}T00:00:00Z`);

  if (Number.isNaN(reqStart.getTime()) || Number.isNaN(reqEnd.getTime())) {
    throw new Error(`Rango inválido: fechas no parseables (${startDate} al ${endDate}).`);
  }
  if (reqEnd < reqStart) {
    throw new Error(`Rango inválido: fin (${endDate}) anterior a inicio (${startDate}).`);
  }

  const requestedDays =
    Math.max(1, Math.round((reqEnd.getTime() - reqStart.getTime()) / DAY_MS) + 1);

  const today = toUtcDay(new Date());
  const yesterday = new Date(today.getTime() - DAY_MS);
  const effEnd = reqEnd > yesterday ? yesterday : reqEnd;

  // Todo el rango es futuro: nada observado todavía (sin fabricar).
  if (effEnd < reqStart) {
    return { observations: [], partialCoverage: true, requestedDays, coveredDays: 0, sources: [] };
  }

  const effEndStr = isoDay(effEnd);
  const pastBoundary = new Date(today.getTime() - FORECAST_PAST_LIMIT_DAYS * DAY_MS);
  const pastBoundaryStr = isoDay(pastBoundary);

  const observations: DailyObservedWeather[] = [];
  const usedSources = new Set<HistoricalWeatherSource>();

  if (effEnd < pastBoundary) {
    // Pasado remoto completo: una sola llamada al Archive API.
    const obs = await fetchHistoricalSlice(
      "https://archive-api.open-meteo.com/v1/archive",
      latitude,
      longitude,
      startDate,
      effEndStr,
      HISTORICAL_ARCHIVE_DAILY_VARS,
      {},
      "open-meteo-archive"
    );
    observations.push(...obs);
    usedSources.add("open-meteo-archive");
  } else if (reqStart >= pastBoundary) {
    // Pasado reciente completo: una sola llamada al Forecast API con
    // past_days explícito (cobertura documentada hasta 92 días).
    const pastDays = Math.min(
      FORECAST_PAST_LIMIT_DAYS,
      Math.max(1, Math.round((today.getTime() - (reqStart as Date).getTime()) / DAY_MS) + 1)
    );
    const obs = await fetchHistoricalSlice(
      "https://api.open-meteo.com/v1/forecast",
      latitude,
      longitude,
      startDate,
      effEndStr,
      HISTORICAL_FORECAST_DAILY_VARS,
      { past_days: String(pastDays) },
      "open-meteo-past"
    );
    observations.push(...obs);
    usedSources.add("open-meteo-past");
  } else {
    // El rango cruza el límite: dos llamadas disjuntas como máximo.
    const archiveEnd = new Date(pastBoundary.getTime() - DAY_MS);
    const [oldPart, recentPart] = await Promise.all([
      fetchHistoricalSlice(
        "https://archive-api.open-meteo.com/v1/archive",
        latitude,
        longitude,
        startDate,
        isoDay(archiveEnd),
        HISTORICAL_ARCHIVE_DAILY_VARS,
        {},
        "open-meteo-archive"
      ),
      fetchHistoricalSlice(
        "https://api.open-meteo.com/v1/forecast",
        latitude,
        longitude,
        pastBoundaryStr,
        effEndStr,
        HISTORICAL_FORECAST_DAILY_VARS,
        { past_days: String(FORECAST_PAST_LIMIT_DAYS) },
        "open-meteo-past"
      ),
    ]);
    observations.push(...oldPart, ...recentPart);
    usedSources.add("open-meteo-archive");
    usedSources.add("open-meteo-past");
  }

  observations.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const coveredDays = observations.length;
  return {
    observations,
    partialCoverage: coveredDays < requestedDays,
    requestedDays,
    coveredDays,
    sources: [...usedSources],
  };
}
