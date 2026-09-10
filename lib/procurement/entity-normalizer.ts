/**
 * GATE 4: ENTITY NORMALIZER (NORMALIZACIÓN DE OFERENTES Y CONSORCIOS)
 * 
 * Reglas canónicas:
 * 1. Detección precisa de personas jurídicas individuales vs consorcios.
 * 2. Extracción de miembros de consorcio ÚNICAMENTE cuando estén explícitos
 *    en el texto (cero invención o alucinación).
 * 3. Normalización canónica de razones sociales (unaccent, eliminación de sufijos legales
 *    para matching, preservación de razón social original).
 * 4. Limpieza y validación de RUC paraguayo (Módulo 11).
 */

export interface NormalizedEntity {
  nombre_original: string;
  nombre_normalizado: string;
  nombre_canonico: string;
  ruc_clean: string | null;
  dv: string | null;
  es_consorcio: boolean;
  tipo_entidad: "PERSONA_FISICA" | "SA" | "SRL" | "CONSORCIO" | "OTRO";
  consorcio_data?: {
    nombre_consorcio: string;
    miembros_identificados: Array<{
      nombre: string;
      nombre_normalizado: string;
      participacion_pct: number | null;
    }>;
    miembros_completos: boolean;
  };
}

export function normalizarTexto(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export const SIGLAS_CONVOCANTES: Record<string, string[]> = {
  MOPC: ["MINISTERIO DE OBRAS PUBLICAS Y COMUNICACIONES", "MOPC"],
  ANDE: ["ADMINISTRACION NACIONAL DE ELECTRICIDAD", "ANDE"],
  IPS: ["INSTITUTO DE PREVISION SOCIAL", "IPS"],
  MEC: ["MINISTERIO DE EDUCACION Y CIENCIAS", "MINISTERIO DE EDUCACION Y CULTURA", "MEC"],
  MSPBS: ["MINISTERIO DE SALUD PUBLICA Y BIENESTAR SOCIAL", "MSPYBS", "MSPBS"],
  DNCP: ["DIRECCION NACIONAL DE CONTRATACIONES PUBLICAS", "DNCP"],
  ESSAP: ["EMPRESA DE SERVICIOS SANITARIOS DEL PARAGUAY", "ESSAP"],
  PETROPAR: ["PETROLEOS PARAGUAYOS", "PETROPAR"],
};

export function coincideConvocante(query: string | null | undefined, buyer: string | null | undefined): boolean {
  if (!query || !buyer) return false;
  const qNorm = normalizarTexto(query);
  const bNorm = normalizarTexto(buyer);
  if (bNorm.includes(qNorm) || qNorm.includes(bNorm)) return true;

  for (const [sigla, aliases] of Object.entries(SIGLAS_CONVOCANTES)) {
    const siglaNorm = normalizarTexto(sigla);
    if (qNorm === siglaNorm || aliases.some((a) => qNorm.includes(a))) {
      if (aliases.some((a) => bNorm.includes(a))) return true;
    }
  }
  return false;
}

export function limpiarRuc(rucRaw: string | null | undefined): { ruc_clean: string | null; dv: string | null } {
  if (!rucRaw || !rucRaw.trim()) return { ruc_clean: null, dv: null };
  const clean = rucRaw.trim().replace(/\s+/g, "");
  const parts = clean.split("-");
  const base = parts[0].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const dv = parts.length > 1 ? parts[1].trim() : null;
  return {
    ruc_clean: base.length > 0 ? base : null,
    dv: dv && dv.length > 0 ? dv : null,
  };
}

const SUFIJOS_LEGALES = [
  /\bS\.?A\.?E\.?C\.?A\.?\b/gi,
  /\bS\.?A\.?C\.?I\.?\b/gi,
  /\bS\.?A\.?\b/gi,
  /\bS\.?R\.?L\.?\b/gi,
  /\bE\.?I\.?R\.?L\.?\b/gi,
  /\bSOCIEDAD ANONIMA\b/gi,
  /\bSOCIEDAD DE RESPONSABILIDAD LIMITADA\b/gi,
];

export function extraerNombreCanonico(nombre: string): string {
  let s = normalizarTexto(nombre);
  for (const suf of SUFIJOS_LEGALES) {
    s = s.replace(suf, "");
  }
  return s.replace(/[.\s]+$/, "").replace(/\s+/g, " ").trim();
}

export function clasificarTipoEntidad(nombre: string): NormalizedEntity["tipo_entidad"] {
  const norm = normalizarTexto(nombre);
  if (norm.startsWith("CONSORCIO") || norm.includes("ASOCIACION ACCIDENTAL")) {
    return "CONSORCIO";
  }
  if (norm.includes("S.A.") || norm.includes("SOCIEDAD ANONIMA") || norm.includes("SAECA") || norm.includes("SACI")) {
    return "SA";
  }
  if (norm.includes("S.R.L.") || norm.includes("SOCIEDAD DE RESPONSABILIDAD")) {
    return "SRL";
  }
  return "OTRO";
}

/**
 * Normaliza un oferente y, si es un consorcio, extrae los miembros
 * explícitamente detallados sin jamás alucinar o inventar miembros ausentes.
 */
export function normalizarOferente(nombreRaw: string, rucRaw?: string | null): NormalizedEntity {
  const nombreLimpio = nombreRaw.trim();
  const norm = normalizarTexto(nombreLimpio);
  const { ruc_clean, dv } = limpiarRuc(rucRaw);
  const esConsorcio = norm.startsWith("CONSORCIO") || norm.includes("ASOCIACION ACCIDENTAL");
  const tipo = clasificarTipoEntidad(nombreLimpio);

  if (!esConsorcio) {
    return {
      nombre_original: nombreLimpio,
      nombre_normalizado: norm,
      nombre_canonico: extraerNombreCanonico(nombreLimpio),
      ruc_clean,
      dv,
      es_consorcio: false,
      tipo_entidad: tipo,
    };
  }

  // Análisis estricto de Consorcio
  // Patrón 1: "CONSORCIO XYZ (EMPRESA A - EMPRESA B)" o "(EMPRESA A / EMPRESA B)"
  // Patrón 2: "CONSORCIO XYZ (EMPRESA A 60% / EMPRESA B 40%)"
  let nombreConsorcio = nombreLimpio;
  const miembros: Array<{ nombre: string; nombre_normalizado: string; participacion_pct: number | null }> = [];
  let miembrosCompletos = false;

  const parenMatch = nombreLimpio.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    nombreConsorcio = parenMatch[1].trim();
    const contenidoParentesis = parenMatch[2].trim();

    // Separadores de miembros: prioritariamente '/', ';', ' - ' (espacio guión espacio), o ' Y '
    let posiblesMiembros: string[];
    if (contenidoParentesis.includes("/")) {
      posiblesMiembros = contenidoParentesis.split(/\s*\/\s*/);
    } else if (contenidoParentesis.includes(";")) {
      posiblesMiembros = contenidoParentesis.split(/\s*;\s*/);
    } else if (/\s+-\s+/.test(contenidoParentesis)) {
      posiblesMiembros = contenidoParentesis.split(/\s+-\s+/);
    } else if (/\s+Y\s+/i.test(contenidoParentesis)) {
      posiblesMiembros = contenidoParentesis.split(/\s+Y\s+/i);
    } else {
      posiblesMiembros = contenidoParentesis.split(/\s*[-/]\s*/);
    }

    for (const m of posiblesMiembros) {
      const item = m.trim();
      if (!item) continue;

      // Buscar si incluye porcentaje: "TOCSA 60%" o "60% TOCSA"
      const pctMatch = item.match(/(\d+(?:\.\d+)?)\s*%/);
      const pct = pctMatch ? parseFloat(pctMatch[1]) : null;
      const nombreMiembro = item.replace(/\d+(?:\.\d+)?\s*%/, "").trim();

      if (nombreMiembro.length > 2) {
        miembros.push({
          nombre: nombreMiembro,
          nombre_normalizado: normalizarTexto(nombreMiembro),
          participacion_pct: pct,
        });
      }
    }

    if (miembros.length >= 2) {
      miembrosCompletos = true;
    }
  }

  return {
    nombre_original: nombreLimpio,
    nombre_normalizado: normalizarTexto(nombreConsorcio),
    nombre_canonico: extraerNombreCanonico(nombreConsorcio),
    ruc_clean,
    dv,
    es_consorcio: true,
    tipo_entidad: "CONSORCIO",
    consorcio_data: {
      nombre_consorcio: nombreConsorcio,
      miembros_identificados: miembros,
      miembros_completos: miembrosCompletos,
    },
  };
}
