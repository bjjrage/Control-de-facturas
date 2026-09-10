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

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 4
* **IMPLEMENTATION**:
  - Motor de huella competitiva contextual (empresa × organismo × rubro × tamaño × rivales).
* **TESTS**:
  - Validación de fingerprints contra competidores conocidos.
* **RISKS**:
  - Muestras pequeñas en nichos especializados.
* **DEFINITION OF DONE**:
  - Perfil analítico de competidores operativo y auditable.

---

## GATE 5B — Cost Engine V1

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Motor de estimación de costo presente determinístico y auditable (`getCurrentCostEstimate`).
  - Captura de observaciones de costo desde cotizaciones, órdenes de compra, recepciones y facturas.
* **TESTS**:
  - Pruebas de dispersión, staleness y ponderación de observaciones.
* **RISKS**:
  - Volatilidad de precios en rubros con alta inflación o dependencia cambiaria.
* **DEFINITION OF DONE**:
  - Cálculo determinístico de costo estimado con rangos y desglose de fuentes.

---

## GATE 6 — Cost Cold Start / Historical Onboarding

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 5B
* **IMPLEMENTATION**:
  - Onboarding de empresas mediante carga ágil de 3 a 5 obras históricas (presupuestos, facturas, consumos).
* **TESTS**:
  - Ingestión de planillas Excel de cómputo y calibración del motor de costos.
* **RISKS**:
  - Heterogeneidad de formatos de Excel de clientes.
* **DEFINITION OF DONE**:
  - Empresa nueva operativa en el motor de costos en menos de 1 hora.

---

## GATE 7 — Item Matching Engine

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 2, GATE 5B
* **IMPLEMENTATION**:
  - Pipeline híbrido de emparejamiento de ítems de pliego con catálogo y recursos.
* **TESTS**:
  - Benchmark de acierto sobre pliegos reales (>90% resolución automática).
* **RISKS**:
  - Descripciones genéricas o ambiguas en pliegos.
* **DEFINITION OF DONE**:
  - Resolución automática con compuertas determinísticas y review humano solo en excepciones.

---

## GATE 8 — Strict Temporal Backtest

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 4, GATE 5A, GATE 5B
* **IMPLEMENTATION**:
  - Evaluación walk-forward temporal (2015-2019 → 2020, etc.) sin data leakage.
* **TESTS**:
  - Métricas de error (MAE, MAPE, winning price error) y calibración.
* **RISKS**:
  - Sobreajuste en modelos predictivos.
* **DEFINITION OF DONE**:
  - Informe cuantitativo de backtesting con veredicto ACCEPT / MODIFY / REJECT.

---

## GATE 9 — Company Bid Vault

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Bóveda estructurada y versionada de documentos de licitación (legal, fiscal, financiero, experiencia, personal, maquinaria).
* **TESTS**:
  - Pruebas de vencimientos, estados y metadatos estructurados.
* **RISKS**:
  - Dispersión de formatos y tipos de documentos.
* **DEFINITION OF DONE**:
  - Repositorio documental reutilizable con trazabilidad total.

---

## GATE 10 — External Document Connectors

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - Conectores oficiales y viables con fuentes gubernamentales (DNIT, IPS, etc.) para refresh automático.
* **TESTS**:
  - Pruebas de integración y manejo de fallos en APIs externas.
* **RISKS**:
  - Cambios de esquema o indisponibilidad en plataformas estatales.
* **DEFINITION OF DONE**:
  - Actualización desatendida de certificados clave cuando existan canales oficiales.

---

## GATE 11 — Compliance Engine

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - Matriz estructurada de verificación de pliego contra el Bid Vault y el ERP.
* **TESTS**:
  - Evaluación de cumplimiento sobre pliegos con requisitos complejos de experiencia y solvencia.
* **RISKS**:
  - Interpretación de cláusulas complejas en pliegos no estandarizados.
* **DEFINITION OF DONE**:
  - Diagnóstico automatizado de requisitos (CUMPLIDO, GENERABLE, FALTANTE) con respaldo probatorio.

---

## GATE 12 — Institution Intelligence

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Perfil analítico por convocante (tiempos de pago, adendas, concentración de proveedores, cancelaciones).
* **TESTS**:
  - Métricas de distribución temporal de desembolsos.
* **RISKS**:
  - Ambigüedad en fechas efectivas de pago en datos OCDS.
* **DEFINITION OF DONE**:
  - Ficha de riesgo y comportamiento contractual por entidad compradora.

---

## GATE 13 — Financial Analysis of Tender

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 5B, GATE 12
* **IMPLEMENTATION**:
  - Análisis financiero previo a ofertar: capital de trabajo, costo financiero, flujo proyectado y estrés de liquidez.
* **TESTS**:
  - Simulación de escenarios (Base, Conservador, Estrés) contra el flujo de caja del ERP.
* **RISKS**:
  - Descalce entre plazos teóricos de contrato y plazos reales de cobro.
* **DEFINITION OF DONE**:
  - Cálculo de margen económico real ajustado por capital y tiempo.

---

## GATE 14 — Tender Operations Agent V1

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 7, GATE 9, GATE 11, GATE 13
* **IMPLEMENTATION**:
  - Orquestador autónomo de preparación de ofertas: armado de expedientes, planillas económicas y formularios.
* **TESTS**:
  - Generación de paquetes de oferta completos en estado READY TO SIGN.
* **RISKS**:
  - Errores de tipeo o formato en formularios oficiales.
* **DEFINITION OF DONE**:
  - Expediente de licitación armado automáticamente listo para revisión humana final.

---

## GATE 15 — Tender Monitoring Agent

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 14
* **IMPLEMENTATION**:
  - Monitor autónomo de adendas, aclaraciones, fechas, apertura y adjudicaciones post-presentación.
* **TESTS**:
  - Detección reactiva de adendas y alertas de actualización de oferta.
* **RISKS**:
  - Latencia en la publicación de documentos en la DNCP.
* **DEFINITION OF DONE**:
  - Notificaciones selectivas y oportunas ante cambios en llamados seguidos.

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
