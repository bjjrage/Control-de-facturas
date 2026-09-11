/**
 * HISTORICAL ONBOARDING ENGINE (GATE 6)
 * Ingestión flexible de planillas de cómputo y presupuestos históricos (Excel/CSV/JSON)
 * para calibración inmediata (< 1 hora) del Cost Engine de una nueva constructora.
 */

import * as XLSX from 'xlsx';
import { CostObservation, CostSource, InputCategory } from './types';

export interface OnboardingColumnMapping {
  itemCol?: string;        // Nombre de columna o índice
  unitCol?: string;
  qtyCol?: string;
  priceCol?: string;
  categoryCol?: string;
  dateCol?: string;
  providerCol?: string;
}

export interface HistoricalWorkIngestionResult {
  projectName: string;
  totalRowsRead: number;
  validObservations: number;
  skippedRows: number;
  observations: Array<Omit<CostObservation, 'id'>>;
  inferredCategories: Record<InputCategory, number>;
  errors: string[];
}

/**
 * Normaliza nombres de columnas para detección heurística automática
 */
function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Infiere automáticamente la categoría del insumo a partir de palabras clave en Paraguay
 */
export function inferInputCategory(description: string): InputCategory {
  const desc = description.toLowerCase();

  // Combustibles
  if (desc.includes('gasoil') || desc.includes('diesel') || desc.includes('nafta') || desc.includes('combustible')) {
    return 'COMBUSTIBLE';
  }

  // Equipos y maquinaria
  if (
    desc.includes('motoniveladora') || desc.includes('retroexcavadora') || desc.includes('camion') ||
    desc.includes('pala cargadora') || desc.includes('tractor') || desc.includes('compactador') ||
    desc.includes('hora') || desc.includes('alquiler') || desc.includes('grua')
  ) {
    return 'EQUIPO';
  }

  // Mano de obra
  if (
    desc.includes('oficial') || desc.includes('ayudante') || desc.includes('capataz') ||
    desc.includes('jornal') || desc.includes('salario') || desc.includes('armador') ||
    desc.includes('electricista') || desc.includes('plomero')
  ) {
    return 'MANO_OBRA';
  }

  // Subcontratos
  if (desc.includes('subcontrato') || desc.includes('instalacion termomecanica') || desc.includes('perforacion')) {
    return 'SUBCONTRATO';
  }

  // Por defecto es Material de construcción
  return 'MATERIAL';
}

/**
 * Parsea un buffer de planilla Excel o CSV de obra histórica
 */
export function parseHistoricalSpreadsheet(
  buffer: Buffer,
  options: {
    empresaId: string;
    projectName: string;
    defaultDate?: string;
    defaultSource?: CostSource;
    customMapping?: OnboardingColumnMapping;
  }
): HistoricalWorkIngestionResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const result: HistoricalWorkIngestionResult = {
    projectName: options.projectName,
    totalRowsRead: rawRows.length,
    validObservations: 0,
    skippedRows: 0,
    observations: [],
    inferredCategories: {
      MATERIAL: 0,
      MANO_OBRA: 0,
      EQUIPO: 0,
      SUBCONTRATO: 0,
      COMBUSTIBLE: 0,
      OTRO: 0
    },
    errors: []
  };

  if (rawRows.length === 0) {
    result.errors.push('La planilla está vacía');
    return result;
  }

  // Detectar columnas automáticamente si no se especificaron
  const headers = Object.keys(rawRows[0]);
  const mapping: { [key: string]: string } = {};

  for (const h of headers) {
    const norm = normalizeHeader(h);
    if (!mapping.item && (norm.includes('item') || norm.includes('descripcion') || norm.includes('concepto') || norm.includes('detalle'))) {
      mapping.item = h;
    } else if (!mapping.unit && (norm.includes('unidad') || norm.includes('unid') || norm.includes('ud') || norm.includes('un'))) {
      mapping.unit = h;
    } else if (!mapping.qty && (norm.includes('cantidad') || norm.includes('cant') || norm.includes('computo'))) {
      mapping.qty = h;
    } else if (!mapping.price && (norm.includes('precio') || norm.includes('costo') || norm.includes('unitario') || norm.includes('punit'))) {
      mapping.price = h;
    } else if (!mapping.date && (norm.includes('fecha') || norm.includes('periodo'))) {
      mapping.date = h;
    }
  }

  // Sobrescribir con mapeo manual si fue provisto
  if (options.customMapping) {
    if (options.customMapping.itemCol) mapping.item = options.customMapping.itemCol;
    if (options.customMapping.unitCol) mapping.unit = options.customMapping.unitCol;
    if (options.customMapping.qtyCol) mapping.qty = options.customMapping.qtyCol;
    if (options.customMapping.priceCol) mapping.price = options.customMapping.priceCol;
    if (options.customMapping.dateCol) mapping.date = options.customMapping.dateCol;
  }

  if (!mapping.item || !mapping.price || !mapping.qty || !mapping.unit) {
    result.errors.push(`No se pudieron mapear las columnas obligatorias de Ítem, Precio Unitario, Cantidad y Unidad de Medida (Detectadas: ${headers.join(', ')}). No se permiten defaults ficticios.`);
    return result;
  }

  if (!mapping.date && !options.defaultDate) {
    result.errors.push('No se pudo mapear columna de Fecha y no se especificó defaultDate para la planilla. Se rechaza inferencia silenciosa.');
    return result;
  }

  const defaultSource = options.defaultSource || 'FACTURA';

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const desc = String(row[mapping.item] || '').trim();

    // Limpiar precio
    let rawPrice = row[mapping.price];
    if (typeof rawPrice === 'string') {
      // Manejar formato guaraní con puntos o comas
      rawPrice = rawPrice.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
    }
    const unitPrice = Number(rawPrice);

    // Validar cantidad sin inventar defaults
    let rawQty = row[mapping.qty];
    if (typeof rawQty === 'string') {
      rawQty = rawQty.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
    }
    const qty = Number(rawQty);

    // Validar unidad sin inventar 'UN'
    const unit = row[mapping.unit] ? String(row[mapping.unit]).trim().toUpperCase() : '';

    // Validar fecha sin inventar CURRENT_DATE
    const dateStr = mapping.date && row[mapping.date] ? String(row[mapping.date]).trim() : (options.defaultDate || '');

    // Validación estricta de fila (UNKNOWN != DEFAULT)
    if (!desc || desc.length < 2 || isNaN(unitPrice) || unitPrice <= 0 || isNaN(qty) || qty <= 0 || !unit || !dateStr) {
      result.skippedRows++;
      continue;
    }

    const category = inferInputCategory(desc);

    result.observations.push({
      empresaId: options.empresaId,
      fuente: defaultSource,
      descripcionItem: desc,
      categoriaInsumo: category,
      cantidad: qty,
      unidad: unit,
      precioUnitario: unitPrice,
      moneda: 'PYG',
      monedaOriginal: 'PYG',
      precioUnitarioOriginal: unitPrice,
      tipoCambio: 1.0,
      fechaObservacion: dateStr,
      esVolatil: category === 'COMBUSTIBLE',
      estadoEvidencia: 'VALIDA'
    });

    result.inferredCategories[category]++;
    result.validObservations++;
  }

  return result;
}
