/**
 * GATE 4: OFFER EXTRACTOR (EXTRACCIÓN DE OFERTAS Y EVALUACIÓN DE CONFIANZA)
 * 
 * Reglas canónicas:
 * 1. Parseo estricto de moneda paraguaya (PYG con puntos de mil: "612.391.600").
 * 2. Validación de consistencia matemática contra montos referenciales.
 * 3. Detección de motivos de descalificación y estado de la oferta.
 * 4. Cálculo determinístico de Score de Confianza (0.00 - 1.00).
 *    Extracciones con confianza < 0.80 se marcan para revisión humana.
 */

import { normalizarOferente, NormalizedEntity } from "./entity-normalizer";

export interface ExtractedBid {
  oferente_raw: string;
  oferente_normalizado: NormalizedEntity;
  monto_ofertado: number | null;
  moneda: string;
  lote_numero: number | null;
  estado_oferta: "ADMITIDA" | "DESCALIFICADA" | "GANADORA" | "RECHAZADA";
  motivo_descalificacion: string | null;
  confidence_score: number;
  requiere_revision_humana: boolean;
  warnings: string[];
}

export function parsearMontoParaguayo(textoMonto: string | null | undefined): number | null {
  if (!textoMonto || !textoMonto.trim()) return null;
  // Quitar símbolos de moneda ("Gs.", "PYG", "$")
  let clean = textoMonto.replace(/Gs\.?|PYG|₲|\$/gi, "").trim();

  // En Guaraníes se usan puntos de mil y sin decimales: "612.391.600"
  // Si hay coma al final con ceros ",00", quitarla
  if (clean.includes(",")) {
    clean = clean.split(",")[0];
  }
  // Quitar todos los puntos de separación de miles
  clean = clean.replace(/\./g, "").trim();

  const num = parseInt(clean, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

const DESCALIFICACION_KEYWORDS = [
  { term: "DESCALIFICADO", estado: "DESCALIFICADA" },
  { term: "DESCALIFICADA", estado: "DESCALIFICADA" },
  { term: "NO CUMPLE", estado: "DESCALIFICADA" },
  { term: "RECHAZADA", estado: "RECHAZADA" },
  { term: "RECHAZADO", estado: "RECHAZADA" },
  { term: "INHABILITADO", estado: "DESCALIFICADA" },
  { term: "DESESTIMADA", estado: "RECHAZADA" },
  { term: "ADJUDICADO", estado: "GANADORA" },
  { term: "ADJUDICADA", estado: "GANADORA" },
  { term: "GANADOR", estado: "GANADORA" },
];

export function evaluarEstadoOferta(texto: string): {
  estado: ExtractedBid["estado_oferta"];
  motivo: string | null;
} {
  const upper = texto.toUpperCase();
  for (const item of DESCALIFICACION_KEYWORDS) {
    if (upper.includes(item.term)) {
      // Extraer posible contexto o motivo
      const idx = upper.indexOf(item.term);
      const motivoSnippet = texto.slice(idx, idx + 120).trim();
      return {
        estado: item.estado as ExtractedBid["estado_oferta"],
        motivo: item.estado !== "GANADORA" ? motivoSnippet : null,
      };
    }
  }
  return { estado: "ADMITIDA", motivo: null };
}

/**
 * Extrae y valida una oferta económica a partir de los datos crudos
 * del acta de apertura o cuadro comparativo, calculando el score de confianza.
 */
export function extraerYValidarOferta(rawInput: {
  oferenteNombre: string;
  oferenteRuc?: string | null;
  montoTexto?: string | null;
  lote?: number | null;
  contextoTexto?: string;
  montoReferencialLicitacion?: number | null;
}): ExtractedBid {
  const warnings: string[] = [];
  const normalizado = normalizarOferente(rawInput.oferenteNombre, rawInput.oferenteRuc);
  const monto = parsearMontoParaguayo(rawInput.montoTexto);

  const { estado, motivo } = evaluarEstadoOferta(
    `${rawInput.oferenteNombre} ${rawInput.contextoTexto || ""}`
  );

  let confidence = 1.0;

  // Validación 1: Presencia y consistencia de monto
  if (monto === null) {
    confidence -= 0.35;
    warnings.push("Monto ofertado no legible o nulo");
  } else if (rawInput.montoReferencialLicitacion && rawInput.montoReferencialLicitacion > 0) {
    const ratio = monto / rawInput.montoReferencialLicitacion;
    // En licitaciones paraguayas, ofertas válidas oscilan entre 0.65x y 1.25x del referencial
    if (ratio < 0.40 || ratio > 2.0) {
      confidence -= 0.30;
      warnings.push(`Monto fuera de rango esperado (${(ratio * 100).toFixed(0)}% del presupuesto referencial)`);
    } else if (ratio < 0.65 || ratio > 1.20) {
      confidence -= 0.10;
      warnings.push(`Monto al límite del rango referencial (${(ratio * 100).toFixed(0)}%)`);
    }
  }

  // Validación 2: RUC presente y válido
  if (!normalizado.ruc_clean) {
    confidence -= 0.10;
    warnings.push("RUC no provisto en la oferta");
  }

  // Validación 3: Nombre del oferente verosímil
  if (normalizado.nombre_original.length < 4) {
    confidence -= 0.25;
    warnings.push("Razón social demasiado corta o sospechosa");
  }

  confidence = Math.max(0.0, Math.min(1.0, parseFloat(confidence.toFixed(2))));

  return {
    oferente_raw: rawInput.oferenteNombre,
    oferente_normalizado: normalizado,
    monto_ofertado: monto,
    moneda: "PYG",
    lote_numero: rawInput.lote ?? 1,
    estado_oferta: estado,
    motivo_descalificacion: motivo,
    confidence_score: confidence,
    requiere_revision_humana: confidence < 0.80,
    warnings,
  };
}
