// Cliente de la API OCDS de la DNCP (Parte C1 del plan).
//
// Endpoint público, sin autenticación, ~4 llamados/segundo. Para producción a
// escala se registra una app OAuth 2.0 (contrataciones.gov.py/datos/adm/login)
// y se sube el límite; para el radar de una empresa el ritmo actual alcanza.
//
// Verificado contra licitaciones reales: 391731, 476974, 485798, ~30 de Capiatá.

const BASE = "https://www.contrataciones.gov.py/datos/api/v3/doc";
const OCID_PREFIX = "ocds-03ad3f-";

// Rate limiter simple: una cola con espaciado mínimo entre llamados.
const MIN_INTERVAL_MS = 300; // ~3.3 req/s, debajo del techo de 4
let lastCall = 0;
let chain: Promise<unknown> = Promise.resolve();

async function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastCall + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

export class DncpNotFoundError extends Error {
  constructor(nro: string) {
    super(`Licitación ${nro} no encontrada en la DNCP`);
    this.name = "DncpNotFoundError";
  }
}

async function getJson(url: string, attempt = 0): Promise<unknown> {
  const res = await throttled(() => fetch(url, { headers: { Accept: "application/json" } }));

  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return getJson(url, attempt + 1);
  }
  if (res.status === 404) {
    throw new DncpNotFoundError(url);
  }
  if (!res.ok) {
    throw new Error(`DNCP API ${res.status} en ${url}`);
  }
  return res.json();
}

export function normalizarNro(input: string): string {
  // Acepta "391731", "ocds-03ad3f-391731", o una URL del portal.
  const m = input.match(/(\d{4,})/);
  if (!m) throw new Error(`No se pudo extraer el número de licitación de "${input}"`);
  return m[1];
}

export function ocidDe(nro: string): string {
  return `${OCID_PREFIX}${nro}`;
}

export interface DncpRecordResult {
  compiledRelease: Record<string, unknown>;
  releases: Record<string, unknown>[];
  ocid: string;
  version?: string;
  uri?: string;
}

/**
 * Trae el record OCDS completo de una licitación preservando tanto el `compiledRelease`
 * como el historial completo de `releases[]`.
 */
export async function fetchFullRecord(nroOrInput: string): Promise<DncpRecordResult> {
  const nro = normalizarNro(nroOrInput);
  const data = (await getJson(`${BASE}/ocds/record/${ocidDe(nro)}`)) as {
    status?: number;
    records?: {
      ocid?: string;
      version?: string;
      uri?: string;
      compiledRelease?: Record<string, unknown>;
      releases?: unknown[];
    }[];
  };

  if (data.status === 404 || !data.records || data.records.length === 0) {
    throw new DncpNotFoundError(nro);
  }
  const rec = data.records[0];
  if (!rec.compiledRelease) {
    throw new Error(`El record ${nro} no trae compiledRelease`);
  }
  return {
    compiledRelease: rec.compiledRelease,
    releases: (rec.releases as Record<string, unknown>[]) || [],
    ocid: rec.ocid || ocidDe(nro),
    version: rec.version,
    uri: rec.uri
  };
}

/**
 * Trae el record OCDS compilado de una licitación. Devuelve el `compiledRelease`.
 */
export async function fetchRecord(nroOrInput: string): Promise<Record<string, unknown>> {
  const full = await fetchFullRecord(nroOrInput);
  return full.compiledRelease;
}

/**
 * Lista releases publicados en un rango de fechas. Usado por el radar (C3).
 * La API pagina; devolvemos un iterador de páginas.
 */
export async function* fetchReleasesPorFecha(
  desde: string,
  hasta: string
): AsyncGenerator<Record<string, unknown>[]> {
  let page = 1;
  for (;;) {
    const url = `${BASE}/ocds/releases?fecha_desde=${desde}&fecha_hasta=${hasta}&page=${page}`;
    let data: { releases?: Record<string, unknown>[]; pagination?: { total_pages?: number } };
    try {
      data = (await getJson(url)) as typeof data;
    } catch {
      return;
    }
    const releases = data.releases ?? [];
    if (releases.length === 0) return;
    yield releases;
    const totalPages = data.pagination?.total_pages ?? page;
    if (page >= totalPages) return;
    page++;
  }
}
