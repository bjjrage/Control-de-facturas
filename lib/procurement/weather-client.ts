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
