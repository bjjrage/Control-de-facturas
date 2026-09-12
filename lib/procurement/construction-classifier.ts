/**
 * Construction Taxonomy Classifier for Official DNCP Processes
 */

export interface ClassificationResult {
  isConstructionRelevant: boolean;
  bucket: string | null;
  method: 'STRUCTURED_WORKS' | 'STRUCTURED_CATEGORY' | 'TEXT_INCLUSION';
  reason: string;
}

// Official DNCP category details that are 100% Works / Construction
const DIRECT_WORKS_CATEGORIES = [
  'Obras - Construcción, Restauración, Reconstrucción o Remodelación y Reparación de Inmuebles',
  'Obras - Servicios de Construccion y Mantenimiento',
  'Obras - Componentes y Suministros de Fabricacion Estructuras, Obras y Construcciones',
  'Obras - Servicios de Limpieza Industrial',
  'Obras - Servicios Editoriales de Diseño, Graficos y de Bellas Artes',
  'Obras - Servicios de Contratacion Agricola Pesquera, Forestal y de Fauna',
];

// Keywords for specific sub-buckets within construction
const BUCKET_PATTERNS: Array<{ bucket: string; regex: RegExp }> = [
  {
    bucket: 'BRIDGES',
    regex: /\b(puente|puentes|pasarela|pasarelas|cabecera.*arroyo|alcantarilla.*celular|pontone?s?)\b/i,
  },
  {
    bucket: 'WATER_SANITATION',
    regex: /\b(pozo.*artesiano|pozos.*artesianos|red.*distribucion.*agua|agua.*potable|alcantarillado|desagüe|desague|pluvial|tanque.*agua|planta.*tratadora.*agua|saneamiento)\b/i,
  },
  {
    bucket: 'ROAD_INFRASTRUCTURE',
    regex: /\b(empedrado|empedrados|asfaltado|asfalto|pavimento|pavimentacion|pavimentación|vial|viales|caminos?.*vecinales?|enripiado|cordon.*cuneta|bacheo|regularizacion.*asfaltica)\b/i,
  },
  {
    bucket: 'ELECTRICAL_INSTALLATIONS',
    regex: /\b(electrificacion|electrificación|linea.*media.*tension|subestacion|subestación|alumbrado.*publico|tendido.*electrico|transformador.*puesto|instalacion.*electrica)\b/i,
  },
  {
    bucket: 'MECHANICAL_INSTALLATIONS',
    regex: /\b(climatizacion|climatización|ascensor|ascensores|sistema.*contra.*incendio|montacargas|generador.*electrico.*instalacion)\b/i,
  },
  {
    bucket: 'MAINTENANCE_REHABILITATION',
    regex: /\b(mantenimiento.*edificio|mantenimiento.*edilicio|reparacion.*edificio|reparaciones.*menores.*edificio|adecuacion.*edilicia|readecuacion.*edilicia|pintura.*edificio|refaccion|remodelacion|reparacion.*infraestructura)\b/i,
  },
  {
    bucket: 'CONSTRUCTION_MATERIALS',
    regex: /\b(cemento|hormigon|hormigón|piedra.*triturada|arena.*lavada|ladrillos?|varillas?.*hierro|asfalto.*en.*frio|mezcla.*asfaltica|materiales?.*construccion)\b/i,
  },
  {
    bucket: 'BUILDINGS',
    regex: /\b(aula|aulas|escuela|colegio|hospital|usf|puesto.*salud|centro.*salud|tinglado|polideportivo|palacete|sede|edificio|vivienda|viviendas|bano|baño|sanitario|muro|estacionamiento|plaza|parque|fachada)\b/i,
  },
  {
    bucket: 'CIVIL_INFRASTRUCTURE',
    regex: /\b(construccion|construcción|obra|obras|infraestructura|canalizacion|canalización|defensa.*costera|dragado|gaviones?)\b/i,
  }
];

// Strict non-construction negative terms to eliminate false positives
const TIER3_NEGATIVE_PATTERNS = [
  /\blimpieza\b/i,
  /\bhigienizaci[oó]n\b/i,
  /\bdesinfecci[oó]n\b/i,
  /\bfumigaci[oó]n\b/i,
  /\blimpieza.*oficinas?\b/i,
  /\blimpieza.*hospitalaria\b/i,
  /\bresiduos?\b/i,
  /\bbasura\b/i,
  /\bmantenimiento.*veh[ií]culos?\b/i,
  /\breparaci[oó]n.*veh[ií]culos?\b/i,
  /\bmantenimiento.*camionetas?\b/i,
  /\breparaci[oó]n.*camionetas?\b/i,
  /\bneum[aá]ticos?\b/i,
  /\bcubiertas?\b/i,
  /\bmantenimiento.*mec[aá]nico.*maquinaria\b/i,
  /\brepuestos?.*maquinaria\b/i,
  /\bveh[ií]culos?\b/i,
  /\bcamioneta\b/i,
  /\bautom[oó]vil\b/i,
  /\balimentos?\b/i,
  /\balmuerzo.*escolar\b/i,
  /\bmerienda\b/i,
  /\bcatering\b/i,
  /\bgastron[oó]mico\b/i,
  /\bmedicamentos?\b/i,
  /\bfarmac[eé]uticos?\b/i,
  /\bseguridad.*vigilancia\b/i,
  /\bseguros?\b/i,
  /\bcombustibles?\b/i,
  /\bsoftware\b/i,
  /\bcomputadoras?\b/i,
  /\bimpresoras?\b/i,
  /\bfotocopiadoras?\b/i,
  /\bpapeler[ií]a\b/i,
  /\buniformes?\b/i,
  /\btextiles?\b/i,
  /\blibros?\b/i,
  /\bservicio.*m[eé]dico\b/i,
  /\bservicio.*odontol[oó]gico\b/i,
];

// Explicit physical work anchors REQUIRED for Tier 3 inclusion
const TIER3_PHYSICAL_WORK_ANCHORS = [
  /\bobras?\b/i,
  /\bconstrucci[oó]n\b/i,
  /\breparaci[oó]n.*edilicia\b/i,
  /\bmantenimiento.*edilicio\b/i,
  /\brefacci[oó]n\b/i,
  /\brehabilitaci[oó]n\b/i,
  /\bpavimento\b/i,
  /\bempedrado\b/i,
  /\basfalto\b/i,
  /\bbacheo\b/i,
  /\bpuentes?\b/i,
  /\balcantarillado\b/i,
  /\bdesag[uü]e\b/i,
  /\bdrenaje\b/i,
  /\bhormig[oó]n\b/i,
  /\bestructuras?\b/i,
  /\btechos?\b/i,
  /\bcubierta.*edilicia\b/i,
  /\binstalaci[oó]n.*el[eé]ctrica\b/i,
  /\bsubestaci[oó]n\b/i,
  /\bred.*de.*agua\b/i,
  /\btuber[ií]as?\b/i,
  /\bveredas?\b/i,
  /\bcord[oó]n.*cuneta\b/i,
];

export function classifyProcess(tender: any): ClassificationResult {
  const cat = (tender.mainProcurementCategory || '').toLowerCase();
  const catDet = tender.mainProcurementCategoryDetails || '';
  const title = (tender.title || '').trim();

  // Tier 1: Structured Category is an official Works Category (Deterministic)
  const isWorksCategory = cat === 'works' || catDet.startsWith('Obras -');

  if (isWorksCategory) {
    for (const bp of BUCKET_PATTERNS) {
      if (bp.regex.test(title) || bp.regex.test(catDet)) {
        return {
          isConstructionRelevant: true,
          bucket: bp.bucket,
          method: 'STRUCTURED_WORKS',
          reason: `Official Category: ${catDet}`,
        };
      }
    }
    return {
      isConstructionRelevant: true,
      bucket: 'CIVIL_INFRASTRUCTURE',
      method: 'STRUCTURED_WORKS',
      reason: `Official Category: ${catDet} (General Works)`,
    };
  }

  // Tier 2: Specific Construction / Works Services or Materials Categories
  // Ensure generic maintenance or equipment categories are NOT admitted here
  const isConstructionServiceCat =
    catDet === 'Servicios - Servicios de Construccion y Mantenimiento' ||
    catDet === 'Bienes - Componentes y Suministros de Fabricacion Estructuras, Obras y Construcciones' ||
    catDet === 'Bienes - Maquinaria y Accesorios para Construccion y Edificacion';

  if (isConstructionServiceCat) {
    // Check that title is not an explicit vehicle/food/unrelated mismatch
    let isNegative = false;
    for (const neg of TIER3_NEGATIVE_PATTERNS) {
      if (neg.test(title)) {
        isNegative = true;
        break;
      }
    }

    if (!isNegative) {
      for (const bp of BUCKET_PATTERNS) {
        if (bp.regex.test(title)) {
          return {
            isConstructionRelevant: true,
            bucket: bp.bucket,
            method: 'STRUCTURED_CATEGORY',
            reason: `Structured Category: ${catDet}`,
          };
        }
      }
      return {
        isConstructionRelevant: true,
        bucket: 'OTHER_CONSTRUCTION_RELEVANT',
        method: 'STRUCTURED_CATEGORY',
        reason: `Structured Category: ${catDet}`,
      };
    }
  }

  // Tier 3: Hardened Text Fallback for infrastructure maintenance / materials in mixed categories
  if (
    catDet.includes('Mantenimientos y reparaciones') ||
    catDet.includes('Materiales e insumos') ||
    catDet.includes('Servicios Técnicos') ||
    catDet.includes('Servicios basados en ingenieria')
  ) {
    // 1. Strict Negative Check: immediately exclude non-construction terms
    for (const neg of TIER3_NEGATIVE_PATTERNS) {
      if (neg.test(title)) {
        return {
          isConstructionRelevant: false,
          bucket: null,
          method: 'TEXT_INCLUSION',
          reason: `Excluded by negative pattern: ${neg.toString()}`,
        };
      }
    }

    // 2. Strict Positive Check: requires explicit physical-work anchor
    let hasPhysicalAnchor = false;
    for (const anchor of TIER3_PHYSICAL_WORK_ANCHORS) {
      if (anchor.test(title)) {
        hasPhysicalAnchor = true;
        break;
      }
    }

    if (hasPhysicalAnchor) {
      for (const bp of BUCKET_PATTERNS) {
        if (bp.regex.test(title)) {
          return {
            isConstructionRelevant: true,
            bucket: bp.bucket,
            method: 'TEXT_INCLUSION',
            reason: `Physical work anchor matched: ${title.slice(0, 60)}`,
          };
        }
      }
      return {
        isConstructionRelevant: true,
        bucket: 'CIVIL_INFRASTRUCTURE',
        method: 'TEXT_INCLUSION',
        reason: `Physical work anchor matched: ${title.slice(0, 60)}`,
      };
    }
  }

  return {
    isConstructionRelevant: false,
    bucket: null,
    method: 'STRUCTURED_CATEGORY',
    reason: `Non-construction category: ${catDet}`,
  };
}
