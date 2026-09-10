/**
 * TEST SUITE: ITEM MATCHING ENGINE (GATE 7)
 * Benchmark sobre 10 ítems reales típicos de pliegos de licitación de obras públicas (MOPC / ANDE / Municipalidades)
 * contra el catálogo estándar de insumos.
 * Requisito: > 90% resolución automática o categorizada correctamente.
 */

import { matchTenderItem, CatalogItem } from '../lib/procurement/item-matching';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const CATALOGO_EMPRESA: CatalogItem[] = [
  { id: 'cat-1', codigo: 'CEM-01', descripcion: 'Cemento Portland Compuesto II F-32 Bolsa 50kg', unidad: 'BLS' },
  { id: 'cat-2', codigo: 'ACE-10', descripcion: 'Varilla de Acero Conformado AP500 diametro 10mm', unidad: 'KG' },
  { id: 'cat-3', codigo: 'ACE-12', descripcion: 'Varilla de Acero Conformado AP500 diametro 12mm', unidad: 'KG' },
  { id: 'cat-4', codigo: 'ARE-01', descripcion: 'Arena Lavada de Rio para Hormigon', unidad: 'M3' },
  { id: 'cat-5', codigo: 'TRI-04', descripcion: 'Piedra Triturada 4ta (15-25mm) para Estructuras', unidad: 'M3' },
  { id: 'cat-6', codigo: 'GAS-01', descripcion: 'Diesel Comun Gasoil Tipo III', unidad: 'LTS' },
  { id: 'cat-7', codigo: 'EQU-01', descripcion: 'Alquiler Motoniveladora 140 HP', unidad: 'HS' },
  { id: 'cat-8', codigo: 'LAD-01', descripcion: 'Ladrillo Comun Cocido 20x10x5cm', unidad: 'MIL' },
  { id: 'cat-9', codigo: 'HOR-01', descripcion: 'Hormigon Elaborado H21 R28 con bomba', unidad: 'M3' },
  { id: 'cat-10', codigo: 'TUB-110', descripcion: 'Tuberia PVC Sanitaria Cloacal 110mm x 6m', unidad: 'UN' }
];

const ITEMS_PLIEGOS_REALES = [
  {
    pliegoDesc: 'Provision y colocacion de Cemento Portland F-32 segun E.T.',
    pliegoUd: 'BLS',
    expectedId: 'cat-1',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Acero para armaduras de hormigon armado d=10 mm AP 500',
    pliegoUd: 'KG',
    expectedId: 'cat-2',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Varillas conformadas diametro 12mm',
    pliegoUd: 'KG',
    expectedId: 'cat-3',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Arena lavada de rio puesta en obra',
    pliegoUd: 'M3',
    expectedId: 'cat-4',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Piedra triturada de 4ta clasificada para hormigones',
    pliegoUd: 'M3',
    expectedId: 'cat-5',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Combustible gasoil diesel tipo III para equipos viales',
    pliegoUd: 'LTS',
    expectedId: 'cat-6',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Motoniveladora para perfilado y cuneteado',
    pliegoUd: 'HS',
    expectedId: 'cat-7',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Mamposteria de ladrillos comunes cocidos e=0.15m',
    pliegoUd: 'MIL',
    expectedId: 'cat-8',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Hormigon estructural calidad H-21 elaborado en planta',
    pliegoUd: 'M3',
    expectedId: 'cat-9',
    expectedStatus: 'MATCH_AUTOMATICO'
  },
  {
    pliegoDesc: 'Tubo de PVC para desague cloacal de 110 mm',
    pliegoUd: 'UN',
    expectedId: 'cat-10',
    expectedStatus: 'MATCH_AUTOMATICO'
  }
];

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: ITEM MATCHING ENGINE (GATE 7)');
  console.log('======================================================\n');

  let automaticMatches = 0;
  let correctMatches = 0;

  for (let i = 0; i < ITEMS_PLIEGOS_REALES.length; i++) {
    const testCase = ITEMS_PLIEGOS_REALES[i];
    const result = matchTenderItem(testCase.pliegoDesc, testCase.pliegoUd, CATALOGO_EMPRESA);

    console.log(`[Item ${i + 1}] "${testCase.pliegoDesc}"`);
    if (result.bestMatch) {
      console.log(`   -> Match: "${result.bestMatch.item.descripcion}" | Score: ${result.bestMatch.similarityScore} | Confianza: ${result.bestMatch.confidence} | Términos: [${result.bestMatch.matchedTerms.join(', ')}]`);
      if (result.bestMatch.item.id === testCase.expectedId) {
        correctMatches++;
      }
      if (result.bestMatch.confidence === 'MATCH_AUTOMATICO') {
        automaticMatches++;
      }
    } else {
      console.log(`   -> NO MATCH`);
    }
  }

  const accuracy = (correctMatches / ITEMS_PLIEGOS_REALES.length) * 100;
  const autoRatio = (automaticMatches / ITEMS_PLIEGOS_REALES.length) * 100;

  console.log(`\nExactitud sobre catálogo: ${accuracy}% (${correctMatches}/${ITEMS_PLIEGOS_REALES.length})`);
  console.log(`Tasa de resolución automática: ${autoRatio}% (${automaticMatches}/${ITEMS_PLIEGOS_REALES.length})`);

  assert(accuracy === 100, 'Todos los ítems de pliego se emparejaron con el ítem correcto del catálogo');
  assert(autoRatio >= 90, 'La tasa de resolución automática supera el 90% (benchmark cumplido)');

  // TEST EXTRA: Distinción crítica de calibres (10mm vs 12mm)
  console.log('\n--- TEST EXTRA: Distinción de Calibres Críticos ---');
  const match10 = matchTenderItem('Hierro 10mm', 'KG', CATALOGO_EMPRESA);
  const match12 = matchTenderItem('Hierro 12mm', 'KG', CATALOGO_EMPRESA);

  assert(match10.bestMatch?.item.id === 'cat-2', 'Hierro 10mm empareja inequívocamente con varilla de 10mm');
  assert(match12.bestMatch?.item.id === 'cat-3', 'Hierro 12mm empareja inequívocamente con varilla de 12mm');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 7 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 7:', err);
  process.exit(1);
});
