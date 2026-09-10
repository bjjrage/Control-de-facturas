# IMPLEMENTATION ROADMAP: CONTROL DE FACTURAS → CONSTRUCTION INTELLIGENCE (RE-AUDITED)

Este documento es el roadmap canónico de ejecución técnica auditado rigurosamente para separar implementaciones probadas, código base/scaffold, coberturas parciales e invenciones.

**ESTADOS TRAS AUDITORÍA**:
- **PROVEN_DONE**: Código productivo con pruebas empíricas reales verificadas contra datos o esquemas.
- **PARTIAL**: Componentes funcionales o pipelines reales pero con cobertura incompleta o módulos faltantes (ej: OCR).
- **SCAFFOLD_ONLY**: Funciones o algoritmos escritos en memoria / esquemas definidos, pero sin integración a la UI, base de datos de producción o pipelines automáticos.
- **INVALID**: Cálculos o aserciones engañosas / ficticias (ej: MAPE evaluado sobre mocks sintéticos idénticos a los datos de entrenamiento).
- **BLOCKED**: Dependencias no resueltas que impiden su operación segura.

---

## RESUMEN EJECUTIVO DE AUDITORÍA (GATES 0 — 21)

| Gate | Nombre | Estado Anterior | Estado Auditado | Evidencia Real | Gap Principal |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0** | Cerrar Auditoría / Hardening | DONE | **PROVEN_DONE** | `0059_gate0_*.sql`, scripts pasan | Migración SQL pendiente de aplicar en remoto |
| **1** | Data Reliability Spike | DONE | **PROVEN_DONE** | 123 licitaciones, 30 PDFs auditados | Actas son 100% escaneadas (raster), no hay OCR integrado |
| **2** | Procurement Evidence Foundation | DONE | **PROVEN_DONE** | `0060_procurement_*.sql`, deduplicación | Esquema relacional probado con scripts locales |
| **3** | Historical Backfill | DONE | **PARTIAL** | Pipeline resiliente con checkpointing | Solo 20 archivos de muestra; 2015-2023 incompleto |
| **4** | Offer Extraction + Entity Normalization | DONE | **PROVEN_DONE** | Normalizador de consorcios y extractor `extraerOfertasDeTexto` | Extracción multioferta desde actas/tablas y 100% precisión en auditoría probada |
| **5A** | Competitor Intelligence V1 | DONE | **PROVEN_DONE** | Directorio `/competidores`, perfil 360° `/competidores/[ruc]` y fallback jerárquico | Integrado con actas locales y base nacional; navegación fluida y 5/5 tests probados |
| **5B** | Cost Engine V1 (CPP) | DONE | **PROVEN_DONE** | Fórmulas de decaimiento y fuentes | Conectado a compras y conciliación de facturas del ERP |
| **6** | Cost Cold Start / Onboarding | DONE | **PROVEN_DONE** | Parser `onboarding.ts` y UI modal en `/licitaciones` | Modal funcional para subir Excel/CSV y calibrar insumos |
| **7** | Item Matching Engine | DONE | **PROVEN_DONE** | Tokenizador, stopwords y calibres paraguayos | Integrado en la vista de ítems de `/licitaciones/[id]` con badge de certeza |
| **8** | Strict Temporal Backtest | DONE | **INVALID** | Script `test-temporal-backtest.ts` | **MAPE 0.27% evaluado sobre fixture sintético**, no sobre histórico real |
| **9** | Company Bid Vault | DONE | **PROVEN_DONE** | `0064_company_bid_vault.sql`, UI `/licitaciones/documentos` | Sincronización automática de documentos a `company_bid_vault_items` |
| **10** | External Document Connectors | DONE | **PARTIAL / FAIL-CLOSED** | Algoritmo DV RUC Módulo 11 | **Endpoints estatales convertidos a Fail-Closed (NOT_IMPLEMENTED)** |
| **11** | Compliance Engine | DONE | **PROVEN_DONE** | Evaluador de matriz y extractor PBC `pbc-extractor.ts` | Extractor determinístico de pliegos y evaluación estricta probada |
| **12** | Institution Intelligence | DONE | **PROVEN_DONE** | Algoritmo de scoring de riesgo A, B, C, D, SIN_DATOS | Purga total de defaults sintéticos; convocantes sin datos emiten SIN_DATOS (0 días); 5/5 tests |
| **13** | Financial Analysis of Tender | DONE | **PROVEN_DONE** | Simulación de cashflow fail-closed | Purga total de defaults (tasa y mora explícitas o INSUFFICIENT_EVIDENCE); 3/3 tests |
| **14** | Tender Operations Agent V1 | DONE | **PROVEN_DONE** | Ensamblador de expediente, índice maestro y exportación HTML | Dossier completo exportable y validación estricta contra placeholders probada |
| **15** | Tender Monitoring Agent | DONE | **PROVEN_DONE** | Huella digital de docs, runner `runTenderMonitoringBatch` y `/api/cron/tender-monitoring` | Detección reactiva y programada de adendas, prórrogas y estados |
| **16** | Competitive Simulator | DONE | **PROVEN_DONE** | Monte Carlo Box-Muller y calibración de huellas | Simulación estocástica calibrada con competidores observados probada |
| **17** | Bid Engine | DONE | **PROVEN_DONE** | Evaluador 5 pilares fail-closed (`UNKNOWN != DEFAULT`) | Integración probada con instantáneas inmutables y reglas comerciales |
| **18** | Bid Analysis Snapshot | DONE | **PROVEN_DONE** | `bid_analysis_runs` append-only, SHA-256 canónico | Congelamiento inmutable estricto sin valores sintéticos arbitrarios |
| **19** | Tender → Project | DONE | **PROVEN_DONE** | `executeTenderToProjectTransaction` y botón UI | Botón "Adjudicada → Convertir en Obra" crea proyecto, cómputo y pañol |
| **20** | ERP Execution Flywheel | DONE | **PROVEN_DONE** | `recordCostObservationFromInvoice` en facturas | Idempotencia granular (documento + ítem) alimentando `cost_observations` |
| **21** | Product Hardening / Enterprise | DONE | **SCAFFOLD_ONLY** | `docker-compose.enterprise.yml` y docs | No desplegado ni validado en infraestructura real |

---

## DETALLE POR GATE

### GATE 0 — Cerrar Auditoría / Hardening
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: N/A
* **IMPLEMENTATION**:
  - `supabase/migrations/0059_gate0_security_and_integrity_hardening.sql`: RLS estricto multi-tenant (`empresa_id = public.current_empresa_id()`) en `payment_orders` y `payment_order_invoices`. Triggers de autocompletado y validación cruzada.
  - RPCs transaccionales atómicas: `public.ejecutar_orden_pago_atomica` y `public.registrar_cobro_atomico`.
  - Guardián de integridad `trg_invoice_delete_integrity` que impide el borrado de facturas pagadas o en OPs ejecutadas.
  - Modificaciones en Server Actions con fallbacks defensivos para evitar regresiones.
* **VERIFICACIÓN**:
  - `scripts/verify-gate0-invariants.ts`: Probado y verificado.
* **GAPS**:
  - Migración `0059` aún no ejecutada en base de datos remota de producción Supabase.

---

### GATE 1 — Data Reliability Spike (DNCP / OCDS / Documentos)
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Muestreo cuantitativo de 123 licitaciones y descarga bit a bit de 30 documentos físicos de la DNCP (`scripts/spike-dncp-reliability.ts`).
  - Dataset consolidado `data/dncp-spike-results.json` e informe `docs/DATA_RELIABILITY_REPORT.md`.
* **VERIFICACIÓN**:
  - Hallazgo empírico irrefutable: 100% de actas y cuadros comparativos son imágenes escaneadas (0% texto nativo).
* **GAPS**:
  - No existe OCR integrado para procesar estas imágenes; los precios unitarios de competidores no son accesibles vía OCDS.

---

### GATE 2 — Procurement Evidence Foundation
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 1
* **IMPLEMENTATION**:
  - `supabase/migrations/0060_procurement_evidence_foundation.sql`: Esquema global público (`procurement_*`) y esquema privado multi-tenant (`empresa_licitacion_seguimiento`).
  - RPC `public.ingestar_proceso_ocds_global` idempotente con hash SHA-256.
* **VERIFICACIÓN**:
  - `scripts/test-procurement-foundation.ts` pasa con 0 errores.
* **GAPS**:
  - Esquema probado en local; migración pendiente de despliegue en producción.

---

### GATE 3 — Historical Backfill
* **STATUS**: **PARTIAL**
* **DEPENDENCIES**: GATE 2
* **IMPLEMENTATION**:
  - Pipeline configurable en `scripts/backfill-dncp-history.ts` con checkpointing persistente (`data/backfill-checkpoint.json`).
* **VERIFICACIÓN**:
  - El mecanismo de paginación y checkpointing funciona correctamente.
* **GAPS**:
  - Solo se descargaron 20 licitaciones de prueba. El backfill completo 2015–2024 **NO está ejecutado**.

---

### GATE 4 — Offer Extraction + Entity Normalization
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Migración `0061_consortia_and_normalized_bids.sql` para consorcios, miembros y ofertas normalizadas.
  - Normalizador de entidades en `lib/procurement/entity-normalizer.ts` (`normalizarOferente`): detección de tipo de personería jurídica (SA, SRL, etc.), despiece canónico de consorcios con porcentajes de participación y regla anti-alucinación estricta (no inventar miembros no especificados).
  - Extractor de ofertas en `lib/procurement/offer-extractor.ts`:
    * `parsearMontoParaguayo`: Manejo exacto de puntos de mil y decimales en guaraníes.
    * `evaluarEstadoOferta`: Detección determinística de motivos de descalificación, rechazo o adjudicación.
    * `extraerYValidarOferta`: Scoring de confianza (0.00 a 1.00) y alerta de revisión humana (< 0.80).
    * `extraerOfertasDeTexto`: Parser multioferta capaz de procesar tablas con delimitadores (`|`, `\t`) o texto corrido de Actas de Apertura y Cuadros Comparativos, filtrando líneas de presupuesto referencial.
  - Integración en Server Actions (`app/(internal)/licitaciones/actions.ts`):
    * `extraerOfertasDeActa`: Permite procesar el texto de actas de apertura y persistir/actualizar todos los competidores en `licitacion_oferentes` (`fuente: 'ACTA_PDF' | 'CUADRO_PDF' | 'MANUAL'`).
* **VERIFICACIÓN**:
  - `scripts/test-offer-extraction.ts` (4/4 bloques de prueba pasando con 100% de éxito):
    - Normalización de personas jurídicas y despiece exacto de consorcios.
    - Parseo de expresiones en moneda paraguaya.
    - 10 casos reales de actas auditadas con 100.0% de precisión (umbral >= 90.0%).
    - Extracción multioferta desde texto de acta de apertura real con identificación de ganadores, consorcios y descalificados.

---

### GATE 5A — Competitor Intelligence V1
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 4
* **IMPLEMENTATION**:
  - `0062_competitor_intelligence.sql` con vistas agregadas (`v_procurement_competitor_global`, `v_procurement_competitor_contextual`) y función de fallback contextual.
  - Módulo `lib/procurement/competitor-intelligence.ts` con segmentación multidimensional, cálculo de certeza estadística (`calcularCertezaEstadistica`) y fallback jerárquico determinístico (`calcularHuellaContextual`).
  - Función `listCompetitors` que une la base histórica nacional con oferentes locales del ERP (`licitacion_oferentes`).
  - Función `getCompetitorProfile` con resolución dual (nacional + oferentes locales de actas de apertura).
  - Directorio completo y buscador en `app/(internal)/licitaciones/competidores/page.tsx`.
  - Vista 360° en `app/(internal)/licitaciones/competidores/[ruc]/page.tsx` con KPIs de win rate, agresividad de descuento, red de consorcios y top de convocantes.
  - Vínculos directos en tabla de oferentes de `app/(internal)/licitaciones/[id]/page.tsx` y botón de acceso en la cabecera principal de licitaciones.
* **VERIFICACIÓN**:
  - `scripts/test-competitor-intelligence.ts` valida clasificación por escala, certeza, fallback jerárquico y modelado de 5 competidores reales paraguayos (PROGEN, TOCSA, BARRAIL, OCHO A, CONCRET-MIX).
* **RESULTADO DE AUDITORÍA**: Completado e integrado de extremo a extremo.

---

### GATE 5B — Cost Engine V1 (Costo Presente Ponderado / CPP)
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - `0063_cost_observations.sql`: Tabla de observaciones de costo multi-tenant.
  - Algoritmo en `lib/cost-engine/weighting.ts`: Decaimiento exponencial, atenuación logarítmica y jerarquía de fuentes.
  - Conectado a compras y conciliación de facturas del ERP vía `recordCostObservationFromInvoice` en `app/(internal)/invoices/actions.ts` (Gate 20 Flywheel).
* **VERIFICACIÓN**:
  - `scripts/test-cost-engine.ts` valida el cálculo matemático rigurosamente.
* **RESULTADO DE AUDITORÍA**: Integrado con el flujo de compras e ingresos de facturas.

---

### GATE 6 — Cost Cold Start / Historical Onboarding
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 5B
* **IMPLEMENTATION**:
  - Parser heurístico de planillas de cómputo en `lib/cost-engine/onboarding.ts` con inferencia semántica de categorías (MATERIAL, MANO_OBRA, EQUIPO, COMBUSTIBLE, etc.).
  - Interfaz de carga en modal `ImportarCostosModal` en `/licitaciones` (`importar-costos-modal.tsx`).
  - Server action `importarPlanillaCostosHistoricos` en `app/(internal)/licitaciones/actions.ts` que inserta en lotes de 100 en `cost_observations` y registra auditoría.
* **VERIFICACIÓN**:
  - `scripts/test-historical-onboarding.ts` demuestra reconocimiento preciso de columnas y calibración.
* **GAPS**:
  - Pendiente calibración multi-moneda USD automática en base a tipo de cambio del BCP del día histórico.

---

### GATE 7 — Item Matching Engine
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 2, GATE 5B
* **IMPLEMENTATION**:
  - Tokenizador, normalizador de calibres y stopwords paraguayas en `lib/procurement/item-matching.ts`.
  - Integración en `/licitaciones/[id]/page.tsx` emparejando insumos del pliego contra el catálogo activo de la empresa.
  - Distinción canónica entre Costo Promedio (Inventario/Stock) y Costo de Reposición/Estimado.
* **VERIFICACIÓN**:
  - `scripts/test-item-matching.ts` valida matching automático, difuso y scores de similitud.
* **GAPS**:
  - Ampliar diccionario de sinónimos de jerga vial y civil paraguaya (ej: piedra bruta vs piedra bola).

---

### GATE 8 — Strict Temporal Backtest
* **STATUS**: **INVALID**
* **DEPENDENCIES**: GATE 4, GATE 5A, GATE 5B
* **IMPLEMENTATION**:
  - Script `scripts/test-temporal-backtest.ts`.
* **VERIFICACIÓN**:
  - **FALSIFICADO**: El test corrió sobre un fixture sintético hardcodeado donde los precios de prueba coincidían exactamente con los esperados.
* **GAPS**:
  - Requiere un backtesting real sobre una serie temporal histórica independiente de ofertas de la DNCP. La aserción previa de MAPE 0.27% queda anulada como métrica de producción.

---

### GATE 9 — Company Bid Vault
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - `0064_company_bid_vault.sql`: Esquema de bóveda documental multi-tenant con RLS y metadatos GIN.
  - Módulo `lib/procurement/bid-vault.ts` con funciones de vigencia y carga `fetchCompanyVaultItems`.
  - UI interactiva en `app/(internal)/licitaciones/documentos/` (`documentos-section.tsx`) con métricas de salud (Total, Vigentes, Por vencer, Vencidos) y sincronización con `company_bid_vault_items`.
* **VERIFICACIÓN**:
  - `scripts/test-bid-vault.ts` valida transiciones de vigencia y estado.
* **GAPS**:
  - Subida de archivos binarios al storage bucket de Supabase pendiente de wiring en UI.

---

### GATE 10 — External Document Connectors
* **STATUS**: **PARTIAL / FAIL-CLOSED**
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - `lib/procurement/external-connectors.ts`:
    - Implementación canónica y probada del algoritmo de Dígito Verificador Módulo 11 oficial de la SET/DNIT (`calcularDvRucPy` y `validarRucParaguayo`).
    - Stubs de conectores a DNIT, IPS y DNCP convertidos a **FAIL-CLOSED** (`isCompliant: false`, status `NOT_IMPLEMENTED`).
* **VERIFICACIÓN**:
  - `scripts/test-external-connectors.ts` verifica que ningún conector falsifique certificados ni emita cumplimientos inventados.
* **GAPS**:
  - Integración pendiente con web services / scrapers oficiales autenticados de DNIT, IPS y DNCP.

---

### GATE 11 — Compliance Engine
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - Matriz de evaluación en `lib/procurement/compliance-engine.ts` contra `VaultItem[]` de la bóveda del tenant con normalización y compatibilidad semántica de tipos de documentos.
  - Extractor determinístico de requisitos en `lib/procurement/pbc-extractor.ts` (`extractRequirementsFromPbcText`) que analiza pliegos reales, extrayendo requisitos legales (Art. 40, Poder), fiscales (DNIT, IPS), financieros (Liquidez, Endeudamiento), técnicos (Experiencia acumulada y km) y de equipamiento/personal clave.
  - Reclasificación formal de requerimientos sugeridos a `generateGenericRequirementSuggestions` (`evidenceOrigin: 'GENERIC_REQUIREMENT_SUGGESTIONS'`).
  - Integración en Server Actions (`app/(internal)/licitaciones/actions.ts`):
    - `extraerRequisitosDePliego`: Extrae y persiste la matriz con origen `EXTRACTED_FROM_PBC` y genera el dictamen de cumplimiento.
    - `persistirEvaluacionComercial`: Emplea requisitos reales de pliego cuando están disponibles o sugerencias genéricas si no, manteniendo la regla estricta: Sugerencias genéricas **NO confieren habilitación (`isEligibleToBid = false`)**.
* **VERIFICACIÓN**:
  - `scripts/test-compliance-engine.ts` (4/4 tests pasando):
    - TEST 1: Pliego MOPC vial cumplible califica 100% con bóveda adecuada (`isEligibleToBid: true`).
    - TEST 2: Falla excluyente de experiencia/liquidez descalifica certeramente (`isEligibleToBid: false`).
    - TEST 3: Inferencia dinámica de sugerencias previas al PBC.
    - TEST 4: Extracción completa desde texto de PBC oficial y verificación estricta (fail-closed con bóveda incompleta y habilitación formal 100% con bóveda íntegra).

---

### GATE 12 — Institution Intelligence
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Algoritmo de scoring institucional cuantitativo en `lib/procurement/institution-intelligence.ts`.
  - Calificación de riesgo rigurosa con estado explícito `'SIN_DATOS'` y 0 días de mora (eliminando el default artificial de 90 días en convocantes sin cobros registrados).
* **VERIFICACIÓN**:
  - `scripts/test-institution-intelligence.ts` evalúa la calificación de riesgo (A, B, C, D, SIN_DATOS) en 5 escenarios incluyendo convocantes con llamados pero sin registro de cobros.
* **RESULTADO DE AUDITORÍA**: Purga total de defaults completada. Cero supuestos arbitrarios.

---

### GATE 13 — Financial Analysis of Tender
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 5B, GATE 12
* **IMPLEMENTATION**:
  - Simulador de flujo de caja y capital de trabajo en `lib/procurement/financial-analysis.ts` en 3 escenarios (BASE, CONSERVADOR, ESTRÉS).
  - Regla `UNKNOWN != DEFAULT`: si faltan monto de oferta, costos directos, plazo contractual, plazo de pago del pagador o tasa financiera activa, retorna `financialStatus: 'INSUFFICIENT_EVIDENCE'` y `NO_VIABLE_ALTO_RIESGO` sin simular datos ficticios.
  - Integrado a `persistirEvaluacionComercial` en `app/(internal)/licitaciones/actions.ts` vinculando tasa bancaria real configurable por empresa (`empresa.tasa_financiamiento_anual_pct`).
* **VERIFICACIÓN**:
  - `scripts/test-financial-analysis.ts` valida las ecuaciones de cashflow, viabilidad financiera y fail-closed por falta de evidencia (3/3 tests aprobados).
* **RESULTADO DE AUDITORÍA**: Purga total de defaults (tasa de 12% removida, plazo de 6 meses no admitido sin evidencia). Fail-closed 100% verificado.

---

### GATE 14 — Tender Operations Agent V1
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 7, GATE 9, GATE 11, GATE 13
* **IMPLEMENTATION**:
  - Orquestador de ensamblaje de expediente licitatorio en `lib/procurement/tender-operations.ts` (`assembleTenderPackage`).
  - Generación de borradores de trabajo internos estándar:
    * `DRAFT-FORM-01`: Carta de Presentación de Oferta.
    * `DRAFT-FORM-02`: Declaración Jurada Art. 40 (Ley 2051/03 & Ley 7021/22).
    * `DRAFT-FORM-03`: Planilla de Cómputo Métrico y Precios Unitarios.
  - Validación estricta fail-closed: prohíbe placeholders (`80000000-1`, "Empresa Oferente", "Representante Legal") e ítems sin cotizar (`unitPrice = 0`), forzando `DRAFT_INCOMPLETE`.
  - Vinculación de documentos probatorios vigentes desde la Bóveda (`company_bid_vault_items`).
  - Generación del **Índice Maestro del Expediente de Oferta** (`generateMasterIndex`) detallando estado de integridad y nómina de anexos probatorios.
  - Generación del **Expediente Completo Exportable en HTML** (`exportBidPackageAsDocument`) con estilos aptos para impresión a PDF o presentación con firma digital calificada.
  - Integración en Server Action `generarPliegoOfertaCompleto` en `app/(internal)/licitaciones/actions.ts` con persistencia en `licitaciones.raw_json->'ultimo_paquete_oferta'` y revalidación de rutas.
* **VERIFICACIÓN**:
  - `scripts/test-tender-operations.ts` (5/5 tests pasando):
    - TEST 1: Ensamblaje completo calificado `READY_TO_SIGN`.
    - TEST 2: Detección y bloqueo por documento probatorio faltante en Bóveda (`DRAFT_INCOMPLETE`).
    - TEST 3: Rechazo explícito de RUCs, nombres o representantes placeholders.
    - TEST 4: Detección y bloqueo por ítems sin precio cotizado (`unitPrice = 0`).
    - TEST 5: Generación formal del Índice Maestro y validación del documento HTML exportable para firma.

---

### GATE 15 — Tender Monitoring Agent
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 14
* **IMPLEMENTATION**:
  - Comparador diferencial en `lib/procurement/tender-monitoring.ts` basado en huella digital de documentos (`TenderDocumentFingerprint`: tipo, tipo_detalle, título, url).
  - Discrimina rigurosamente adendas y enmiendas (`NUEVA_ADENDA`, `CRITICAL`) de notas de aclaración (`ACLARACION_PUBLICADA`, `INFO`) y anexos técnicos (`NUEVO_DOCUMENTO`, `INFO`).
  - Motor de sondeo en segundo plano desatendido en `lib/procurement/tender-monitoring-runner.ts` (`runTenderMonitoringBatch`): itera licitaciones activas ordenadas por `synced_at`, consulta la DNCP de forma resiliente, corre la comparación de huellas y persiste alertas operativas en `audit_logs`.
  - Endpoint de cron seguro en `app/api/cron/tender-monitoring/route.ts` con soporte GET y POST, protegido mediante cabecera o bearer token `CRON_SECRET` para ejecución programada en Vercel Cron, GitHub Actions o scheduler de infraestructura.
  - Integrado reactivamente en `importarLicitacion` en `app/(internal)/licitaciones/actions.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-tender-monitoring.ts` valida la discriminación precisa de adendas, prórrogas, aclaraciones y el procesamiento en lote del runner desatendido.
* **GAPS**:
  - Notificaciones en tiempo real vía webhook / Slack / WhatsApp para alertas de severidad `CRITICAL`.

---

### GATE 16 — Competitive Simulator
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 5A, GATE 8
* **IMPLEMENTATION**:
  - Simulador estocástico Monte Carlo Box-Muller en `lib/procurement/competitive-simulator.ts`.
  - Fail-closed: si el presupuesto referencial es <= 0, retorna `INSUFFICIENT_EVIDENCE` sin inventar precios simulados.
  - Metadatos de calibración: rastrea `isCalibrated: false` cuando no existen oferentes observados ni huellas históricas, y `isCalibrated: true` cuando se suministran oferentes y huellas empíricas contextuales (`knownCompetitorFingerprints`).
  - Integración en `persistirEvaluacionComercial` en `app/(internal)/licitaciones/actions.ts`: consulta los oferentes registrados y busca sus huellas contextuales mediante `getCompetitorProfile` para alimentar la simulación.
* **VERIFICACIÓN**:
  - `scripts/test-competitive-simulator.ts` (5/5 tests pasando):
    - TEST 1: Simulación Monte Carlo (10.000 iteraciones) con percentiles ordenados (P10 <= P50 <= P90).
    - TEST 2: Curva monótona de probabilidad de ganar.
    - TEST 3: Fail-closed ante presupuesto referencial nulo o inválido (`INSUFFICIENT_EVIDENCE`).
    - TEST 4: Detección y advertencia de simulación no calibrada.
    - TEST 5: Simulación plenamente calibrada con huellas contextuales observadas (`isCalibrated: true`, 0 missing inputs).

---

### GATE 17 — Bid Engine
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 5A, GATE 5B, GATE 12, GATE 13, GATE 16
* **IMPLEMENTATION**:
  - Motor de agregación de 5 pilares comerciales en `lib/procurement/bid-engine.ts`.
  - Invariante estricto `UNKNOWN != DEFAULT`:
    * Pilar 1 (Cumplimiento): Bloquea `COMPETIR` si los requisitos son sugerencias genéricas y no proceden de PBC oficial.
    * Pilar 2 (Costos): Bloquea si no hay cobertura verificada de cómputo y catálogo.
    * Pilar 3 (Convocante): Asigna advertencia cautelar si la entidad compradora no tiene historial (`SIN_DATOS`).
    * Pilar 4 (Financiero): Bloquea si la simulación financiera tiene evidencia insuficiente.
    * Pilar 5 (Competitividad): Advierte si la simulación es no calibrada; bloquea si no hay presupuesto referencial.
  - Panel visual de evaluación comercial en `app/(internal)/licitaciones/[id]/page.tsx` conectado a `persistirEvaluacionComercial`.
  - Congelamiento inmutable mediante SHA-256 en `bid_analysis_runs`.
* **VERIFICACIÓN**:
  - `scripts/test-bid-engine.ts` (5/5 tests pasando):
    - TEST 1: Caso COMPETIR (Licitación ANDE con todas las evidencias completas).
    - TEST 2: Caso REVISAR (Alerta financiera de capital de trabajo pico).
    - TEST 3: Caso NO_COMPETIR (Descalificación técnica excluyente).
    - TEST 4: Caso NO_COMPETIR (Bloqueo si los requisitos no proceden del PBC oficial).
    - TEST 5: Caso NO_COMPETIR (Bloqueo si la oferta carece de costos directos verificados).

---

### GATE 18 — Bid Analysis Snapshot
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 17
* **IMPLEMENTATION**:
  - `0065_bid_analysis_snapshots.sql`: Tabla `bid_analysis_runs` con trigger estricto que bloquea tanto `UPDATE` como `DELETE` (inmutabilidad estricta append-only en BD).
  - Módulo `lib/procurement/bid-snapshot.ts`: Serialización canónica determinística (`canonicalJsonStringify`) y hashing criptográfico SHA-256 cubriendo la totalidad de los datos del snapshot.
  - Eliminación absoluta de suposiciones sintéticas en `persistirEvaluacionComercial`: costo directo estrictamente de insumos catalogados; plazo contractual exclusivamente de datos oficiales; fail-closed a `REVISAR` o `NO_COMPETIR` si no hay cómputo o presupuesto referencial válido (`UNKNOWN != DEFAULT`).
* **VERIFICACIÓN**:
  - `scripts/test-bid-snapshot.ts` valida la inmutabilidad y la detección inmediata de adulteración sobre cualquier campo canónico del snapshot.
* **GAPS**:
  - Exportación de la corrida congelada en PDF firmado digitalmente para comités de directorio.

---

### GATE 19 — Tender → Project
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 17, GATE 18
* **IMPLEMENTATION**:
  - Motor de transición en `lib/procurement/tender-to-project.ts`.
  - Transacción real `executeTenderToProjectTransaction`: Inserta registro en `projects`, desglosa cómputo métrico en `budget_items`, y crea el depósito/pañol de obra.
  - Server action `convertirLicitacionAProyecto` con validación estricta de adjudicación (`decision === 'GANADA'`), idempotencia y respeto al invariante `UNKNOWN != DEFAULT` (sin inventar plazos ni retenciones).
  - Botón interactivo "Adjudicada → Convertir en Obra" en el detalle de la licitación.
* **VERIFICACIÓN**:
  - `scripts/test-tender-to-project.ts` pasa con éxito validando integridad de montos e invariante `UNKNOWN != DEFAULT`.
* **GAPS**:
  - Generación automática de hitos preliminares en el diagrama de Gantt del proyecto.

---

### GATE 20 — ERP Execution Flywheel
* **STATUS**: **PROVEN_DONE**
* **DEPENDENCIES**: GATE 19
* **IMPLEMENTATION**:
  - Doble bucle de retroalimentación en `lib/procurement/flywheel.ts`.
  - Integración en Server Actions de facturas (`app/(internal)/invoices/actions.ts`): Cada factura creada o vinculada a una Orden de Compra alimenta de inmediato `cost_observations`.
  - Idempotencia garantizada por `documento_id` para evitar observaciones duplicadas y logging auditable de errores.
* **VERIFICACIÓN**:
  - `scripts/test-flywheel.ts` valida la recalibración del Cost Engine ante compras de obra.
* **GAPS**:
  - Extender el listener automático a remisiones de materiales desde el pañol (`remisiones`).

---

### GATE 21 — Product Hardening / Enterprise Deployment
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATES 0–20
* **IMPLEMENTATION**:
  - Configuración Docker Compose en `docker-compose.enterprise.yml`.
  - Guía operativa en `docs/ENTERPRISE_DEPLOYMENT.md`.
* **VERIFICACIÓN**:
  - `scripts/test-enterprise-deployment.ts` verifica la sintaxis de los archivos de configuración.
* **GAPS**:
  - No ha sido desplegado ni probado en un servidor real o clúster de producción.

---

## P0/P1 HARDENING CAMPAIGN — VERIFICACIÓN FINAL Y BLINDAJE

En la campaña de hardening P0/P1 sobre Construction Intelligence se erradicó sistemáticamente la contaminación por supuestos sintéticos bajo la regla canónica `UNKNOWN != DEFAULT`:

1. **Seguridad de Cron (P0)**:
   - `app/api/cron/tender-monitoring/route.ts`: Falla cerrado si `CRON_SECRET` no está configurado (HTTP 500). Autenticación estricta vía cabecera `Authorization: Bearer <secret>`. Se rechazan secretos pasados en query params (HTTP 401).

2. **Extracción PBC & Matriz de Cumplimiento (P0)**:
   - `lib/procurement/pbc-extractor.ts`: Extracción basada en snippets contextuales. Criterios sin cifras explícitas quedan como `CRITERION_UNKNOWN`. Texto vacío genera 0 requisitos.
   - `lib/procurement/compliance-engine.ts`: Purga total de ratios inventados (1.2 liquidez, 50% experiencia, 120 HP). Matriz vacía dictamina `FAIL_CLOSED`. Nuevos estados de dictamen: `CUMPLIDO`, `GENERABLE`, `FALTANTE`, `REVIEW_REQUIRED`.

3. **Semántica de Costos & Análisis de Oferta (P0)**:
   - `app/(internal)/licitaciones/actions.ts`: Eliminado el uso de `productos.costo_promedio` (CPP de inventario) como costo de oferta. Consumo de observaciones reales de compra (`cost_observations`) vía `calculateCostEstimate` + ítems explícitos de APU (`licitacion_oferta_items`). Si no hay oferta registrada, `offerAmountPyg = null` (no se asume el presupuesto referencial). Costos indirectos no configurados quedan en `null`.
   - `lib/procurement/institution-intelligence.ts`: Implementado `getInstitutionProfileFromDb` para consultar datos reales de convocantes y certificados de obra del tenant.
   - `lib/cost-engine/index.ts`: Terminología formal: "costo de reposición / replacement cost" reservando "CPP" estrictamente para valuación de inventario en almacén.

4. **Simulador Competitivo & Motor de Adjudicación (P0)**:
   - `lib/procurement/competitive-simulator.ts`: Eliminados defaults sintéticos (4/6 competidores, 8% descuento, 3.5%/2.8% dispersión). Si hay menos de 2 competidores o huellas observadas, se marca `isCalibrated: false`, `calibrationTier: 'UNCALIBRATED'` y no se emiten precio recomendado ni probabilidad de ganar inventados.
   - `lib/procurement/bid-engine.ts`: Eliminado el fallback de probabilidad de ganar 50%. En ausencia de calibración, `recommendedOfferPricePyg`, `expectedNetMarginPct` y `winProbabilityPct` permanecen estrictamente en `null`.
   - `lib/procurement/bid-snapshot.ts`: Payload canónico y registros de snapshot actualizados para aceptar `number | null`.

5. **Operaciones de Licitación & Preservación de Evidencias (P0/P1)**:
   - `lib/procurement/tender-operations.ts`: Eliminado el default sintético de 90 días de validez; se consume del PBC o permanece `null`. Ítems sin cotizar permanecen en 0 (sin asumir presupuesto referencial).
   - `app/(internal)/licitaciones/actions.ts`: En `importarLicitacion`, el borrado ciego fue reemplazado por reconciliación que preserva estrictamente oferentes de `ACTA_PDF`, `CUADRO_PDF` y `MANUAL`, purgando únicamente registros de `fuente = 'API'`.

6. **Integridad Temporal de Competidores & Backfill (P1)**:
   - `lib/procurement/competitor-intelligence.ts`: Soporte de `asOfDate` y `excludeTenderId` en consultas contextuales para prevenir fuga de datos hacia atrás (lookahead bias) y autolimitación con la propia licitación. Reemplazado default de categoría `OBRAS` por `DESCONOCIDO`.
   - `scripts/backfill-dncp-history.ts`: Métricas granulares de pipeline (`total_fetched`, `total_identified_construction`, `total_file_saved`, `total_db_persisted`, `failure_reasons`). Eliminado el año 2024 como fallback forzado.

7. **Transición a Proyecto & Flywheel de Costos (P1)**:
   - `lib/procurement/tender-to-project.ts`: Eliminado el número de contrato inventado `CONTRATO-{id}` y la asignación automática de fecha de inicio a hoy sin pliego/contrato.
   - `lib/procurement/flywheel.ts`: Validación fail-closed en facturas en USD: si no existe tipo de cambio verificado, se omite el registro para impedir la contaminación de costos con la tasa 1:1.

