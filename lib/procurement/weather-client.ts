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
