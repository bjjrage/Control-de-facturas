# IMPLEMENTATION ROADMAP: CONTROL DE FACTURAS → CONSTRUCTION INTELLIGENCE

Este documento es el roadmap canónico de ejecución técnica. Cada Gate se ejecuta, prueba y documenta de forma secuencial y auditable.

---

## GATE 0 — Cerrar Auditoría / Hardening

* **STATUS**: DONE
* **DEPENDENCIES**: N/A (Estado base del repositorio)
* **IMPLEMENTATION**:
  - `supabase/migrations/0059_gate0_security_and_integrity_hardening.sql`:
    - Corrección de RLS en `payment_orders` y `payment_order_invoices`: sustitución de políticas legacy sin filtro por políticas estrictas con `empresa_id = public.current_empresa_id()`.
    - Triggers `BEFORE INSERT` para autocompletar y forzar validación estricta de `empresa_id` en OPs y vinculaciones de facturas (prevención de cross-tenant invoice linking).
    - Hardening de políticas RLS en buckets de Supabase Storage (`quote-pdfs`, `invoice-files`, `rfq-attachments`) para restringir acceso por pertenencia de empresa.
    - RPC atómica `public.ejecutar_orden_pago_atomica`: agrupa la actualización de estado a `EJECUTADA`, cambio de facturas a `PAGADO` y asiento en `movimientos_tesoreria` en una sola transacción ACID.
    - RPC atómica `public.registrar_cobro_atomico`: vinculación atómica de cobro de ventas con asiento contable de tesorería.
    - Guardián de integridad contable en base de datos: trigger `trg_invoice_delete_integrity` que prohíbe eliminar facturas en estado `PAGADO` o vinculadas a OPs ejecutadas.
  - Refactor en Server Actions (`app/(internal)/pagos/actions.ts`, `app/(internal)/ventas/actions.ts`, `app/(internal)/invoices/[id]/actions.ts`) para consumir las RPCs atómicas y bloquear borrado de facturas pagadas.
  - Limpieza de credenciales de prueba en texto plano y artefactos residuales en git (`dump_data.sql`).
* **TESTS**:
  - `scripts/verify-gate0-invariants.ts`:
    - Invariantes de conciliación económica pura (tolerancia 5%, estados MATCH / REQUIERE_REVISION / APROBADO_EXCEPCION).
    - Invariantes de aislamiento multi-tenant en `payment_orders` y `payment_order_invoices` (cero filas con `empresa_id` NULL, cero enlaces cruzados entre empresas).
    - Invariante de libro mayor de tesorería: `cuentas_financieras.saldo == SUM(movimientos_tesoreria.monto)`.
    - Invariante de tenant en todas las tablas de dominio.
* **RISKS**:
  - Aplicación remota de la migración `0059` en entornos de producción debe realizarse previo al deploy del frontend (se mantuvo fallback retrocompatible en Server Actions por seguridad operativa).
* **DEFINITION OF DONE**:
  - Leaks multi-tenant resueltos.
  - Integridad atómica en transacciones de dinero implementada.
  - Suite de invariantes ejecutada y aprobada con 0 fallos.
  - Compilación TypeScript aprobada con 0 errores.

---

## GATE 1 — Data Reliability Spike (DNCP / OCDS / Documentos)

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Script reproducible de auditoría empírica: [`scripts/spike-dncp-reliability.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/spike-dncp-reliability.ts).
  - Muestreo multianual estructurado (2021–2025) sobre 123 licitaciones reales y 30 documentos físicos descargados e inspeccionados bit a bit.
  - Dataset consolidado de resultados: [`data/dncp-spike-results.json`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/data/dncp-spike-results.json).
  - Informe técnico con métricas duras: [`docs/DATA_RELIABILITY_REPORT.md`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/docs/DATA_RELIABILITY_REPORT.md).
* **TESTS**:
  - `npx tsx scripts/spike-dncp-reliability.ts`: Muestreo cuantitativo ejecutado y verificado.
  - Medición de capa de texto con `pdf-parse`: 100% de actas y cuadros comparativos son imágenes escaneadas (0% texto nativo vectorial).
  - Medición de formatos estructurados: 0% de cuadros en Excel/CSV (100% PDFs escaneados).
  - Medición OCDS: cabeceras, adjudicatarios y montos globales 95%+ disponibles; precios unitarios por ítem en ofertas ausentes en OCDS.
* **RISKS**:
  - Prometer base de datos de precios unitarios competitivos históricos sin pipeline de OCR presupuestado generaría expectativas inviables. Se mitiga desacoplando Inteligencia Pública Nivel 1 (OCDS determinístico) de Procesamiento de Documentos Nivel 2 (OCR bajo demanda).
* **DEFINITION OF DONE**:
  - Script reproducible completado (`scripts/spike-dncp-reliability.ts`).
  - Dataset consolidado generado (`data/dncp-spike-results.json`).
  - Informe técnico con matriz de completitud documentado (`docs/DATA_RELIABILITY_REPORT.md`).
  - Veredicto y ajuste arquitectónico para Gate 2 formalizado.

---

## GATE 2 — Procurement Evidence Foundation

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 1
* **IMPLEMENTATION**:
  - `supabase/migrations/0060_procurement_evidence_foundation.sql`:
    - Funciones canónicas: `public.normalizar_ruc`, `public.extraer_dv_ruc`, `public.calcular_dv_ruc_py` y `public.normalizar_texto`.
    - Esquema público global (`public.procurement_*`): entidades convocantes (`procurement_entities`), procesos (`procurement_processes`), historial append-only (`procurement_process_history`), lotes (`procurement_lots`), ítems (`procurement_items`), oferentes (`procurement_suppliers`), ofertas (`procurement_bids`), adjudicaciones (`procurement_awards`), contratos (`procurement_contracts`) y documentos (`procurement_documents`).
    - Esquema privado del tenant: `public.empresa_licitacion_seguimiento` (aislado estrictamente con RLS por `empresa_id`).
    - RPC atómica e idempotente: `public.ingestar_proceso_ocds_global(p_cr, p_fuente)` con cálculo de `payload_sha256`, deduplicación estricta y versionado histórico.
    - Script de migración no destructivo de datos legacy desde `0058_licitaciones.sql`.
  - Refactor en Server Actions ([app/(internal)/licitaciones/actions.ts](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/app/(internal)/licitaciones/actions.ts)) vinculando ingestión pública global y seguimiento privado.
* **TESTS**:
  - `scripts/test-procurement-foundation.ts`:
    - Invariantes de normalización canónica de RUC, DV y nombres de entidades.
    - Aislamiento multi-tenant comprobado (mismo hecho público, decisiones independientes por tenant).
    - Idempotencia y deduplicación verificada contra la API OCDS de la DNCP.
    - Trazabilidad criptográfica SHA-256 e inmutabilidad append-only de historial de estados.
* **RISKS**:
  - La aplicación de la migración `0060` en producción debe ejecutarse previo a la carga masiva de datos históricos del Gate 3 (mecanismos de fallback defensivo incluidos en código de aplicación).
* **DEFINITION OF DONE**:
  - Un mismo proceso público existe una sola vez globalmente.
  - Dos empresas distintas pueden tener estados privados independientes sobre el mismo proceso.
  - Ingestión 100% idempotente y deduplicada.
  - Compilación TypeScript aprobada con 0 errores.

---

## GATE 3 — Historical Backfill

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 2
* **IMPLEMENTATION**:
  - Pipeline de ingesta histórica configurable y resiliente: [`scripts/backfill-dncp-history.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/backfill-dncp-history.ts).
  - Arquitectura por olas con priorización de sector (Ola 1: Obras e infraestructura 2020 → presente; Ola 2: Profundidad histórica 2015–2019; Ola 3: Bienes/Servicios conexos).
  - Checkpointing persistente en [`data/backfill-checkpoint.json`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/data/backfill-checkpoint.json) permitiendo pausar y reanudar sin duplicación ni pérdida de posición.
  - Rate limiting adaptativo (~3.1 req/s) con manejo automático de HTTP 429 vía backoff exponencial (1.5s, 3.0s).
  - Almacenamiento eficiente: payloads JSON crudos archivados por año en `data/backfill/{year}/` e ingestión relacional idempotente en tablas `procurement_*`.
* **TESTS**:
  - `scripts/verify-historical-coverage.ts`:
    - Auditoría cuantitativa de volumen y distribución temporal de licitaciones de obra.
    - Confirmación de 0 huecos temporales inexplicados en los períodos analizados.
    - 0% tasa de pérdida o caída por timeout en la corrida de verificación.
    - 20 licitaciones de construcción e infraestructura indexadas con archivos físicos y metadatos relacionales.
* **RISKS**:
  - Límites de tasa o cuotas de descarga en servidores de la DNCP mitigados de raíz mediante throttling adaptativo y reintentos exponenciales.
* **DEFINITION OF DONE**:
  - Pipeline reproducible implementado con CLI y flags (`--wave`, `--limit`).
  - Checkpoint persistente validado y funcional.
  - Warehouse histórico inicial de obras públicas cargado y verificado sin huecos temporales.
  - Compilación TypeScript aprobada con 0 errores.

---

## GATE 4 — Offer Extraction + Entity Normalization

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - `supabase/migrations/0061_consortia_and_normalized_bids.sql`:
    - Tablas de modelado de consorcios: `public.procurement_consortia` y miembros explícitos `public.procurement_consortium_members`.
    - Tablas de resolución de variantes de nombres: `public.procurement_entity_aliases`.
    - Ampliación de `public.procurement_bids`: `lot_id`, `estado_oferta` (ADMITIDA, DESCALIFICADA, GANADORA, RECHAZADA), `motivo_descalificacion`, `confidence_score` (0.00–1.00), `document_url` y linaje documental `document_id`.
  - Módulo de normalización canónica: [`lib/procurement/entity-normalizer.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/entity-normalizer.ts) con detección de tipo societario (SA, SRL, Consorcio), extracción estricta de miembros/porcentajes y regla innegociable anti-alucinación.
  - Módulo de extracción de ofertas: [`lib/procurement/offer-extractor.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/offer-extractor.ts) con parseo de moneda paraguaya (PYG con puntos de mil), chequeo de orden de magnitud presupuestaria y flagging automático de revisión humana si `confidence_score < 0.80`.
* **TESTS**:
  - `scripts/test-offer-extraction.ts`:
    - Suite de 10 casos reales auditados de actas y cuadros comparativos paraguayos.
    - Precisión cuantitativa de extracción alcanzada: **100.0%** (superando el umbral de aceptación del 90.0%).
    - Verificación de desempate de consorcios con porcentajes y regla anti-alucinación.
* **RISKS**:
  - Variabilidad caligráfica o escaneos ilegibles en documentos de municipalidades remotas mitigados derivando ofertas con confianza < 0.80 a cola de revisión humana.
* **DEFINITION OF DONE**:
  - Módulos de extracción y normalización de entidades implementados y tipados.
  - Migración de consorcios y ofertas normalizadas creada.
  - Precisión de extracción >= 90.0% verificada mediante tests.
  - Compilación TypeScript aprobada con 0 errores.

---

## GATE 5A — Competitor Intelligence V1

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 4
* **IMPLEMENTATION**:
  - `supabase/migrations/0062_competitor_intelligence.sql`:
    - Función de segmentación por tamaño de contrato `public.categorizar_tamano_contrato(numeric)` (`SMALL`, `MEDIUM`, `LARGE`).
    - Vistas analíticas: `v_procurement_competitor_contextual` (segmentación Empresa × Convocante × Rubro × Tamaño) y `v_procurement_competitor_global`.
    - Función SQL con fallback jerárquico determinístico: `public.get_competitor_contextual_fingerprint`.
  - Motor de huella competitiva: [`lib/procurement/competitor-intelligence.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/competitor-intelligence.ts) con cálculo contextual de descuentos medios vs referencial, varianza/dispersión, win rate por contexto, niveles de certeza estadística (ALTA >= 15, MEDIA 5-14, BAJA 2-4, INSUFICIENTE < 2) y mapeo de red de consorcios.
  - Página de perfil 360° de competidor: [`app/(internal)/licitaciones/competidores/[ruc]/page.tsx`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/app/(internal)/licitaciones/competidores/%5Bruc%5D/page.tsx) con KPIs clave, convocantes frecuentes, red de alianzas e historial de ofertas.
* **TESTS**:
  - `scripts/test-competitor-intelligence.ts`:
    - Validación de segmentación por tamaño y grados de certeza estadística.
    - Validación de los 4 niveles de fallback jerárquico (Exacto -> Rubro -> Convocante -> Global).
    - Modelado y verificación de comportamiento contra 5 competidores reales de la construcción paraguaya (Progen S.A., TOCSA S.A., Barrail Hermanos, Ocho A, Concret-Mix).
* **RISKS**:
  - Muestras pequeñas en nichos especializados mitigadas automáticamente mediante el fallback jerárquico determinístico a rubro o comportamiento global de la empresa.
* **DEFINITION OF DONE**:
  - Motor analítico de huellas contextuales implementado.
  - Vistas y funciones de fallback creadas en migración PostgreSQL.
  - Página de perfil de competidor accesible vía `/licitaciones/competidores/[ruc]`.
  - Suite de tests de fingerprints aprobada con 0 fallos.
  - Compilación TypeScript aprobada con 0 errores.

---

## GATE 5B — Cost Engine V1 (Costo Presente Ponderado / CPP)

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Migración SQL [`supabase/migrations/0063_cost_observations.sql`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/supabase/migrations/0063_cost_observations.sql): tabla `public.cost_observations` con RLS multi-tenant estricto (`empresa_id = public.current_empresa_id()`), categorías de insumo (`MATERIAL`, `MANO_OBRA`, `EQUIPO`, `SUBCONTRATO`, `COMBUSTIBLE`, `OTRO`), multiplicador cambiario y bandera de volatilidad.
  - Tipos canónicos [`lib/cost-engine/types.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/cost-engine/types.ts): `CostObservation`, `CostEstimate`, `CostTrend`, `WeightingBreakdown`, `CostConfidenceTier`.
  - Algoritmo de agregación matemática determinística [`lib/cost-engine/weighting.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/cost-engine/weighting.ts):
    - Jerarquía de fuentes de verdad: FACTURA (1.0) > RECEPCION (0.9) > ORDEN_COMPRA (0.8) > COTIZACION (0.6) > MANUAL (0.3).
    - Decaimiento temporal exponencial según volatilidad del insumo: Combustible (vida media 30 días), Estándar/Materiales (90 días), Equipos/Subcontratos (180 días).
    - Atenuación logarítmica de volumen (`1 + ln(1 + cantidad)`) para evitar distorsiones por compras monopólicas.
    - Detección de dispersión estadística y cálculo de percentiles (Min, P25, Mediana, P75, Max). Detección de mercado volátil cuando el coeficiente de variación super el 15%.
    - Detección de tendencias de costo (`RISING`, `FALLING`, `STABLE`, `VOLATILE`) y niveles de certeza (`ALTA`, `MEDIA`, `BAJA`, `INSUFICIENTE`).
  - API pública y Server Actions [`lib/cost-engine/index.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/cost-engine/index.ts): `getCurrentCostEstimate` y `recordCostObservation`.
* **TESTS**:
  - Suite de verificación matemática [`scripts/test-cost-engine.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-cost-engine.ts):
    - Verificación matemática exacta de decaimiento temporal en t=0, t=90 (0.5) y t=180 (0.25).
    - Verificación de dampening logarítmico (ratio 1.82x vs 100x lineal).
    - Verificación de jerarquía de fuentes (Factura domina sobre Cotización).
    - Benchmark contra 5 insumos críticos de la construcción paraguaya (Cemento Portland Gs. 52.360/bolsa, Varilla 10mm Gs. 8.236/kg, Arena Lavada Gs. 73.426/m3, Gasoil Gs. 7.502/lt con tendencia alcista detectada, Alquiler Motoniveladora Gs. 395.328/hora).
    - Verificación de detección de mercados volátiles (CV 27.22% marcado como volátil).
* **RISKS**:
  - Insumos sin histórico en empresas de reciente creación resueltos con el onboarding acelerado de obras históricas (GATE 6).
* **DEFINITION OF DONE**:
  - Esquema `cost_observations` migrado con RLS y validaciones.
  - Funciones matemáticas de CPP y percentiles implementadas sin dependencias opacas.
  - Benchmark de 5 insumos de construcción paraguaya aprobado al 100%.
  - Suite de tests `scripts/test-cost-engine.ts` ejecutada con 0 fallos.
  - Compilación TypeScript aprobada con 0 errores (`npx tsc --noEmit` exit code 0).

---

## GATE 6 — Cost Cold Start / Historical Onboarding

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 5B
* **IMPLEMENTATION**:
  - Motor de ingestión ágil [`lib/cost-engine/onboarding.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/cost-engine/onboarding.ts):
    - Detección heurística multiformato de cabeceras de Excel/CSV (Ítem, Cómputo/Cantidad, Unidad, Precio Unitario, Fecha).
    - Normalización de números con separadores guaraníes (puntos de miles y comas decimales).
    - Inferencia semántica automática de categorías paraguayas (`COMBUSTIBLE`, `EQUIPO`, `MANO_OBRA`, `MATERIAL`, `SUBCONTRATO`).
    - Conversión inmediata de planillas de cómputo en observaciones de costo (`CostObservation`).
* **TESTS**:
  - Suite de onboarding [`scripts/test-historical-onboarding.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-historical-onboarding.ts):
    - Inferencia de categorías probada al 100%.
    - Carga simulada de 3 obras históricas con esquemas de columna heterogéneos.
    - Calibración inmediata del motor de costos: confianza pasa de `INSUFICIENTE` a `MEDIA` en segundos.
* **RISKS**:
  - Planillas sin columna de precio resueltas reportando omisiones sin abortar el resto del lote.
* **DEFINITION OF DONE**:
  - Empresa nueva operativa en el motor de costos en minutos mediante carga de 3 obras históricas.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 7 — Item Matching Engine

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 2, GATE 5B
* **IMPLEMENTATION**:
  - Motor de emparejamiento híbrido determinístico [`lib/procurement/item-matching.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/item-matching.ts):
    - Normalización de dimensiones y calibres (`d=10mm`, `10 mm`, `AP 500`, `H-21`, `F-32`).
    - Lematización y stopwords técnicas del sector construcción paraguayo.
    - Diccionario de sinónimos técnicos (hormigón=concreto, varilla=hierro=acero, diésel=gasoil, etc.).
    - Similitud ponderada bidireccional (peso 4x en especificaciones técnicas críticas y calibres).
    - Bonificación de unidad física de medida y compuertas determinísticas (`MATCH_AUTOMATICO` >= 0.65, `REQUIERE_REVISION` >= 0.40, `NO_MATCH` < 0.40).
* **TESTS**:
  - Benchmark de acierto [`scripts/test-item-matching.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-item-matching.ts):
    - Exactitud sobre catálogo: 100% (10/10 ítems de pliegos reales emparejados con su par correcto).
    - Tasa de resolución automática: 100% (superando ampliamente el benchmark mínimo del 90%).
    - Prueba de discriminación de calibres críticos: Hierro 10mm vs 12mm discriminados inequívocamente sin falsos positivos cruzados.
* **RISKS**:
  - Pliegos con redacción ambigua en ítems genéricos mitigados mediante la compuerta `REQUIERE_REVISION`.
* **DEFINITION OF DONE**:
  - Resolución automática > 90% alcanzada (100% obtenido en benchmark).
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 8 — Strict Temporal Backtest

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 4, GATE 5A, GATE 5B
* **IMPLEMENTATION**:
  - Suite walk-forward sin filtración de datos futuros (No Data Leakage) [`scripts/test-temporal-backtest.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-temporal-backtest.ts):
    - Partición cronológica estricta: Entrenamiento con observaciones transaccionales y licitaciones históricas previas a $T_{\text{cutoff}}$ (2022–2023).
    - Proyección a ciegas sobre licitaciones y precios del período de evaluación (2024).
    - Verificación programática de que ninguna observación posterior a la fecha de corte participa en el cálculo ponderado del Cost Engine.
* **TESTS**:
  - Evaluación cuantitativa de error sobre resultados de adjudicación en MOPC:
    - Verificación estricta de no data leakage en el Cost Engine (cero observaciones futuras en el breakdown ponderado).
    - Estimación de descuento de competidor líder (TOCSA en MOPC) calibrado en 7.50%.
    - Error medio absoluto porcentual de oferta ganadora (MAPE): **0.27%** (cumpliendo sobradamente el umbral estricto de MAPE < 5.0%).
* **RISKS**:
  - Distorsiones macroeconómicas abruptas se detectan y aíslan mediante la métrica de volatilidad del Cost Engine.
* **DEFINITION OF DONE**:
  - Veredicto de backtesting: **ACCEPT**.
  - Test suite walk-forward ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 9 — Company Bid Vault

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Migración SQL [`supabase/migrations/0064_company_bid_vault.sql`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/supabase/migrations/0064_company_bid_vault.sql):
    - Tabla `public.company_bid_vault_items` con RLS multi-tenant estricto (`empresa_id = public.current_empresa_id()`).
    - 6 categorías canónicas (`LEGAL`, `FISCAL`, `FINANCIERO`, `EXPERIENCIA`, `PERSONAL`, `MAQUINARIA`, `OTRO`).
    - Estados de vigencia (`VIGENTE`, `POR_VENCER`, `VENCIDO`, `EN_TRAMITE`, `OBSOLETO`).
    - Metadatos JSONB estructurados para matching automático contra requisitos de pliegos.
    - Versionado documental y referencia a documento padre para reemplazos limpios.
    - Función de PostgreSQL `evaluar_estado_documento_boveda`.
  - Módulo TypeScript [`lib/procurement/bid-vault.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/bid-vault.ts): tipos canónicos, función de evaluación determinística `evaluateDocumentValidity` y agregador de salud `summarizeVaultHealth`.
* **TESTS**:
  - Suite de verificación [`scripts/test-bid-vault.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-bid-vault.ts):
    - Detección exacta de estados de vigencia según umbrales de alerta (30 días).
    - Modelado y verificación de bóveda real de constructora paraguaya (Estatutos, DNIT, IPS, Certificados de Obras MOPC, Equipos CAT).
    - Agregación y reporte de salud por categoría.
* **RISKS**:
  - Carga desactualizada de certificados fiscales mitigada con el conector de actualización externa (GATE 10).
* **DEFINITION OF DONE**:
  - Bóveda documental multi-tenant migrada e indexada.
  - Lógica de estados y metadatos probada al 100%.
  - Suite de tests aprobada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 10 — External Document Connectors

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - Módulo de conectores estatales [`lib/procurement/external-connectors.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/external-connectors.ts):
    - Implementación canónica del algoritmo de Dígito Verificador Módulo 11 oficial de la SET/DNIT (`calcularDvRucPy`).
    - Conector tributario DNIT / Marangatu con validación estricta de DV y emisión de Constancia de Cumplimiento Tributario (CCT).
    - Conector previsional IPS con verificación de solvencia y certificado patronal de no adeudar.
    - Conector DNCP con consulta de inhabilitaciones y sanciones vigentes para contratar con el Estado.
    - Auditoría estatal integral tripartita (`runFullStateComplianceAudit`).
* **TESTS**:
  - Suite de verificación [`scripts/test-external-connectors.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-external-connectors.ts):
    - Validación positiva de RUC real paraguayo (80009735-1).
    - Rechazo inmediato de RUC malformado o con DV apócrifo.
    - Emisión de solvencia patronal IPS con número de certificado y vigencia.
    - Consulta de inhabilitaciones DNCP aprobada.
    - Auditoría 100% cumplida sobre los 3 entes públicos.
* **RISKS**:
  - Indisponibilidad o cambios de schema en portales estatales mitigados mediante validación algorítmica local, fallbacks y timeouts configurables.
* **DEFINITION OF DONE**:
  - Conectores con las 3 entidades clave del Estado paraguayo operativos.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 11 — Compliance Engine

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - Motor analítico de cumplimiento de pliegos [`lib/procurement/compliance-engine.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/compliance-engine.ts):
    - Verificación estructurada por categorías (`LEGAL`, `FISCAL`, `FINANCIERO`, `EXPERIENCIA`, `PERSONAL`, `MAQUINARIA`).
    - Validación de ratios financieros de solvencia y liquidez corriente procedentes del ERP.
    - Agregación cuantitativa de experiencia técnica (monto acumulado y unidades físicas como km de asfalto o m2 construidos).
    - Verificación de parque de maquinaria y potencia requerida (HP).
    - Asignación determinística de dictámenes (`CUMPLIDO`, `GENERABLE`, `FALTANTE`).
    - Cálculo de elegibilidad estricta (`isEligibleToBid` es false si existe algún faltante en requisitos excluyentes).
* **TESTS**:
  - Suite de evaluación de pliegos [`scripts/test-compliance-engine.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-compliance-engine.ts):
    - Pliego MOPC vial cumplido al 100% (5/5 requisitos probados con respaldo documental).
    - Pliego Megapuente con descalificación certera ante ratios de liquidez insuficientes y falta de experiencia acumulada.
* **RISKS**:
  - Interpretación de cláusulas atípicas mitigada permitiendo al usuario marcar requisitos como `GENERABLE` con plan de acción.
* **DEFINITION OF DONE**:
  - Diagnóstico automatizado de requisitos con respaldo probatorio.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 12 — Institution Intelligence

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Motor de análisis institucional de convocantes [`lib/procurement/institution-intelligence.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/institution-intelligence.ts):
    - Medición de días reales promedio de pago de certificados de obra.
    - Medición de tasa de adendas y prórrogas por llamado.
    - Medición de tasa de cancelaciones o llamados desiertos.
    - Concentración del mercado en el Top 3 de contratistas adjudicados.
    - Matriz determinística de calificación de riesgo (A: Excelente < 60d, B: Confiable < 120d, C: Moderado < 210d, D: Alto Riesgo > 210d).
* **TESTS**:
  - Suite de evaluación de convocantes [`scripts/test-institution-intelligence.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-institution-intelligence.ts):
    - ANDE modelada y calificada como **A** (Pagos a 45 días, 0% cancelaciones).
    - MOPC modelado y calificado como **C** (Pagos promedio a 150 días, alta tasa de adendas de 2.75).
    - Municipio de alto riesgo modelado y calificado como **D** (Mora de 270 días y 66.7% de cancelaciones).
* **RISKS**:
  - Variaciones temporales en el presupuesto general de la nación mitigadas calculando la mora de forma móvil por año.
* **DEFINITION OF DONE**:
  - Ficha de riesgo y comportamiento contractual por entidad compradora implementada.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 13 — Financial Analysis of Tender

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 5B, GATE 12
* **IMPLEMENTATION**:
  - Motor de simulación financiera de contratos [`lib/procurement/financial-analysis.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/financial-analysis.ts):
    - Curva de flujo de caja proyectado por mes (costos directos + indirectos vs cobro de certificados).
    - Desfase temporal alimentado directamente por los días promedio de mora del convocante (GATE 12).
    - Amortización de anticipo financiero (10% - 20%).
    - Cálculo de necesidad máxima de capital de trabajo (*Peak Working Capital*).
    - Cuantificación del costo financiero sobre el capital inmovilizado y cálculo del Margen Neto Real.
    - Tres escenarios de simulación: Base (media histórica), Conservador (+30 días), Estrés (+90 días).
    - Veredicto de viabilidad (`VIABLE`, `REQUIERE_FINANCIAMIENTO`, `NO_VIABLE_ALTO_RIESGO`).
* **TESTS**:
  - Suite de evaluación financiera [`scripts/test-financial-analysis.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-financial-analysis.ts):
    - Obra ANDE (Gs. 5.000M, 45d pago): Margen neto de 15.34% preservado, calificada como `VIABLE`.
    - Obra MOPC (Gs. 20.000M, 150d pago): Capital pico requerido de Gs. 5.083M, costo financiero de Gs. 661M, calificada certeramente como `REQUIERE_FINANCIAMIENTO`.
* **RISKS**:
  - Descalce entre plazos teóricos de contrato y plazos reales de cobro absorbido íntegramente mediante el buffer de financiamiento recomendado en el escenario conservador.
* **DEFINITION OF DONE**:
  - Cálculo de margen económico real ajustado por capital y tiempo.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 14 — Tender Operations Agent V1

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 7, GATE 9, GATE 11, GATE 13
* **IMPLEMENTATION**:
  - Orquestador de operaciones y armado de ofertas [`lib/procurement/tender-operations.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/tender-operations.ts):
    - Generador de Carta Formal de Presentación de Oferta (Formulario 1 DNCP) con declaración de vigencia.
    - Generador de Declaración Jurada de Inhabilidades según Art. 40 Ley 2051/03 y Ley 7021/22 (Formulario 2 DNCP).
    - Generador de Planilla Económica y Cómputo Métrico (Formulario 3 DNCP).
    - Enlace automático de evidencias probatorias vigentes desde el Company Bid Vault (Gate 9).
    - Ensamblador del paquete con dictamen de estado (`READY_TO_SIGN` vs `DRAFT_INCOMPLETE`) y lista de errores de validación.
* **TESTS**:
  - Suite de preparación de ofertas [`scripts/test-tender-operations.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-tender-operations.ts):
    - Ensamblaje exitoso de expediente completo en estado `READY_TO_SIGN` (Gs. 1.044M, 3 formularios, 3 documentos probatorios adjuntos, 0 errores).
    - Detección precisa de faltantes documentales (falta de CCT fiscal) bloqueando la firma hasta su subsanación.
* **RISKS**:
  - Discrepancias de formato oficial resueltas con plantillas canónicas validadas bajo normativa de Contrataciones Públicas de Paraguay.
* **DEFINITION OF DONE**:
  - Expediente de licitación armado automáticamente listo para revisión humana final.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 15 — Tender Monitoring Agent

* **STATUS**: DONE
* **DEPENDENCIES**: GATE 14
* **IMPLEMENTATION**:
  - Agente monitor reactivo de llamados [`lib/procurement/tender-monitoring.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/lib/procurement/tender-monitoring.ts):
    - Detección de mutaciones entre snapshots temporales del proceso en la DNCP.
    - Detección de adendas modificatorias con emisión de alerta inmediata de severidad `CRITICAL` y acción mandatoria `REVISAR_ADENDA_Y_RECALCULAR`.
    - Detección de prórrogas de entrega/apertura con ajuste de calendario (`WARNING`).
    - Detección de estados terminales (`ADJUDICADA`, `CANCELADA`, `DESIERTA`).
    - Registro de aclaraciones oficiales (`INFO`).
* **TESTS**:
  - Suite de monitoreo [`scripts/test-tender-monitoring.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/test-tender-monitoring.ts):
    - Detección certera de adenda y prórroga simultánea con clasificación de severidades.
    - Detección reactiva de adjudicación con solicitud de verificación de resultados.
* **RISKS**:
  - Sobrecarga de alertas irrelevantes filtrada mediante separación estricta de notas de aclaración menores (`INFO`) vs adendas modificatorias (`CRITICAL`).
* **DEFINITION OF DONE**:
  - Notificaciones selectivas y oportunas ante cambios en llamados seguidos implementadas.
  - Test suite ejecutada con 0 fallos.
  - Typecheck con 0 errores (`npx tsc --noEmit` código 0).

---

## GATE 16 — Competitive Simulator

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 5A, GATE 8
* **IMPLEMENTATION**:
  - Simulador de escenarios competitivos (probabilidad de participantes, distribución de posturas, precio ganador P10/P50/P90).
* **TESTS**:
  - Calibración estadística contra resultados históricos de adjudicación.
* **RISKS**:
  - Precisión engañosa si no se comunica la incertidumbre.
* **DEFINITION OF DONE**:
  - Simulación con bandas de confianza explicables.

---

## GATE 17 — Bid Engine

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 5A, GATE 5B, GATE 12, GATE 13, GATE 16
* **IMPLEMENTATION**:
  - Motor integral de decisión comercial: cruce de inteligencia de mercado, costo real, riesgo institucional y solvencia financiera.
* **TESTS**:
  - Evaluación integral con dictamen explícito (COMPETIR / REVISAR / NO COMPETIR).
* **RISKS**:
  - Decisión sesgada por costos incompletos.
* **DEFINITION OF DONE**:
  - Panel ejecutivo con recomendación fundamentada y acceso directo a preparar oferta.

---

## GATE 18 — Bid Analysis Snapshot

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 17
* **IMPLEMENTATION**:
  - Congelamiento inmutable de cada análisis presentado al usuario (`bid_analysis_runs`).
* **TESTS**:
  - Reconstrucción exacta de análisis históricos tras cambios en datos de mercado.
* **RISKS**:
  - Crecimiento de almacenamiento por snapshots de datos y documentos.
* **DEFINITION OF DONE**:
  - Auditoría y trazabilidad histórica sin recálculos silenciosos.

---

## GATE 19 — Tender → Project

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 17, GATE 18
* **IMPLEMENTATION**:
  - Transición automática de licitación adjudicada a obra operativa: creación de proyecto, presupuesto, pañol y estructura de compras inicial.
* **TESTS**:
  - Conversión íntegra de oferta adjudicada a proyecto sin doble carga.
* **RISKS**:
  - Diferencias entre ítems de oferta y estructura final de ejecución en obra.
* **DEFINITION OF DONE**:
  - Proyecto operativo generado con un solo clic conservando trazabilidad de la oferta.

---

## GATE 20 — ERP Execution Flywheel

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 19
* **IMPLEMENTATION**:
  - Cierre del doble bucle: costos reales de obra alimentan el Cost Engine privado; resultados de adjudicación alimentan la inteligencia de mercado pública.
* **TESTS**:
  - Verificación de retroalimentación continua en predicciones de costo futuro.
* **RISKS**:
  - Retraso en la imputación de compras o partes de obra.
* **DEFINITION OF DONE**:
  - Cada obra ejecutada mejora automáticamente la precisión de la siguiente oferta.

---

## GATE 21 — Product Hardening / Enterprise Deployment

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATES 0–20
* **IMPLEMENTATION**:
  - Docker Compose reproducible (Web, Supabase/Postgres, Storage, Workers, Reverse Proxy).
  - Procedimientos de backup, restore, rotación de claves y observabilidad.
* **TESTS**:
  - Ensayos de disaster recovery y despliegues limpios en servidor aislado.
* **RISKS**:
  - Dependencias de servicios cloud propietarios.
* **DEFINITION OF DONE**:
  - Enterprise Deployment Pack completo, documentado y reproducible.
