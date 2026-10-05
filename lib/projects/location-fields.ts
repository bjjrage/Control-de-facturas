/** Optional patch: callers without coordinate fields keep the stored location. */
export function projectLocationPatch(form: FormData): {
  patch: { latitude?: number | null; longitude?: number | null }; error: string | null;
} {
  if (!form.has("latitude") && !form.has("longitude")) return { patch: {}, error: null };
  if (!form.has("latitude") || !form.has("longitude")) {
    return { patch: {}, error: "Enviá latitud y longitud juntas para configurar la ubicación." };
  }
  const lat = String(form.get("latitude") ?? "").trim();
  const lon = String(form.get("longitude") ?? "").trim();
  if (!lat && !lon) return { patch: { latitude: null, longitude: null }, error: null };
  const latitude = Number(lat), longitude = Number(lon);
  if (!lat || !lon || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { patch: {}, error: "Ingresá ambas coordenadas: latitud entre −90 y 90, longitud entre −180 y 180; o dejá ambas vacías." };
  }
  return { patch: { latitude, longitude }, error: null };
}

export function isValidProjectCoords(latitude: unknown, longitude: unknown): boolean {
  if (latitude === null || latitude === undefined || latitude === "") return false;
  if (longitude === null || longitude === undefined || longitude === "") return false;
  const lat = typeof latitude === "string" ? Number(latitude) : (latitude as number);
  const lon = typeof longitude === "string" ? Number(longitude) : (longitude as number);
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}
