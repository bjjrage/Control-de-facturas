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

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - Muestreo representativo de licitaciones de la DNCP (obras, bienes, servicios; diversos años, convocantes y montos).
  - Medición cuantitativa de completitud de cabeceras, pliegos, actas de apertura, cuadros comparativos y adjudicaciones.
  - Ratio de PDFs textuales vs. escaneados y viabilidad de extracción determinística vs. OCR.
* **TESTS**:
  - Script de análisis y matriz cuantitativa de fiabilidad con métricas duras.
* **RISKS**:
  - Variabilidad de calidad en documentos históricos escaneados de la DNCP.
* **DEFINITION OF DONE**:
  - Matriz real de cobertura y calidad documentada con conclusiones objetivas.

---

## GATE 2 — Procurement Evidence Foundation

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 1
* **IMPLEMENTATION**:
  - Separación formal de hechos públicos globales (`public.procurement_*`) de decisiones privadas por tenant.
  - Modelado de procesos, lotes, ítems, oferentes, ofertas, adjudicaciones y contratos con procedencia y checksum.
* **TESTS**:
  - Pruebas de ingestión idempotente y deduplicación.
* **RISKS**:
  - Complejidad de coexistencia con el esquema existente `0058` (requiere migración no destructiva).
* **DEFINITION OF DONE**:
  - Un mismo proceso público existe una sola vez globalmente y múltiples empresas pueden seguirlo independientemente.

---

## GATE 3 — Historical Backfill

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 2
* **IMPLEMENTATION**:
  - Ingestión masiva de datos históricos de contrataciones públicas de Paraguay (2015 → presente).
  - Pipeline con checkpointing, reintentos, logs de progreso y observabilidad.
* **TESTS**:
  - Verificación de volumen, cobertura por año y consistencia relacional.
* **RISKS**:
  - Límites de tasa o cuotas de descarga en servidores de la DNCP.
* **DEFINITION OF DONE**:
  - Warehouse histórico cargado y validado.

---

## GATE 4 — Offer Extraction + Entity Normalization

* **STATUS**: NOT_STARTED
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Pipeline de extracción de ofertas desde Actas de Apertura y Cuadros Comparativos.
  - Normalización de personas jurídicas, consorcios, RUCs y aliases sin alucinaciones.
* **TESTS**:
  - Pruebas de precisión/recall contra actas verificadas manualmente.
* **RISKS**:
  - Nombres comerciales y consorcios con composiciones variables.
* **DEFINITION OF DONE**:
  - Ofertas históricas extraídas con linaje documental y niveles de confianza.

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
