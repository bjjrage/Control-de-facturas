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
| **4** | Offer Extraction + Entity Normalization | DONE | **PARTIAL** | Normalizador de RUC y consorcios | Extracción solo funciona en OCDS/texto estructurado, no en actas escaneadas |
| **5A** | Competitor Intelligence V1 | DONE | **PARTIAL** | Lógica de huellas y página `/competidores/[ruc]` | Depende de la profundidad del backfill en BD para ser estadísticamente útil |
| **5B** | Cost Engine V1 (CPP) | DONE | **PROVEN_DONE** | Fórmulas de decaimiento y fuentes | Conectado a compras y conciliación de facturas del ERP |
| **6** | Cost Cold Start / Onboarding | DONE | **PROVEN_DONE** | Parser `onboarding.ts` y UI modal en `/licitaciones` | Modal funcional para subir Excel/CSV y calibrar insumos |
| **7** | Item Matching Engine | DONE | **PROVEN_DONE** | Tokenizador, stopwords y calibres paraguayos | Integrado en la vista de ítems de `/licitaciones/[id]` con badge de certeza |
| **8** | Strict Temporal Backtest | DONE | **INVALID** | Script `test-temporal-backtest.ts` | **MAPE 0.27% evaluado sobre fixture sintético**, no sobre histórico real |
| **9** | Company Bid Vault | DONE | **PROVEN_DONE** | `0064_company_bid_vault.sql`, UI `/licitaciones/documentos` | Sincronización automática de documentos a `company_bid_vault_items` |
| **10** | External Document Connectors | DONE | **PARTIAL / FAIL-CLOSED** | Algoritmo DV RUC Módulo 11 | **Endpoints estatales convertidos a Fail-Closed (NOT_IMPLEMENTED)** |
| **11** | Compliance Engine | DONE | **SCAFFOLD_ONLY** | Evaluador de matriz de cumplimiento | Pliegos no se parsean automáticamente a esta matriz |
| **12** | Institution Intelligence | DONE | **SCAFFOLD_ONLY** | Algoritmo de scoring institucional | Probado con mocks; sin agregación sobre warehouse completo |
| **13** | Financial Analysis of Tender | DONE | **SCAFFOLD_ONLY** | Modelo matemático de flujo de fondos | No persiste en BD ni se conecta a la tesorería real del ERP |
| **14** | Tender Operations Agent V1 | DONE | **SCAFFOLD_ONLY** | Generador de plantillas de formularios | Strings markdown estáticos; no es un agente autónomo |
| **15** | Tender Monitoring Agent | DONE | **SCAFFOLD_ONLY** | Comparador diferencial de snapshots | Sin scheduler/cron/worker de monitoreo periódico |
| **16** | Competitive Simulator | DONE | **SCAFFOLD_ONLY** | Monte Carlo Box-Muller en memoria | No calibrado con distribuciones empíricas a gran escala |
| **17** | Bid Engine | DONE | **PARTIAL** | Evaluador de 5 pilares | Integrado en panel de análisis comercial en `/licitaciones/[id]` |
| **18** | Bid Analysis Snapshot | DONE | **PARTIAL** | `0065_bid_analysis_snapshots.sql` y hashing | Tabla y hashing creados; falta hooking a la toma de decisiones |
| **19** | Tender → Project | DONE | **PROVEN_DONE** | `executeTenderToProjectTransaction` y botón UI | Botón "Adjudicada → Convertir en Obra" crea proyecto, cómputo y pañol |
| **20** | ERP Execution Flywheel | DONE | **PROVEN_DONE** | `recordCostObservationFromInvoice` en facturas | Cada factura vinculada a OC alimenta `cost_observations` automáticamente |
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
* **STATUS**: **PARTIAL**
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Migración `0061_consortia_and_normalized_bids.sql`.
  - Normalizador de consorcios y RUC en `lib/procurement/entity-normalizer.ts`.
  - Parser de ofertas en `lib/procurement/offer-extractor.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-offer-extraction.ts` valida el parseo sobre strings y fixtures estructurados.
* **GAPS**:
  - Al no haber pipeline de OCR/Vision para PDFs raster, no es posible extraer ofertas de licitaciones reales fuera de la API OCDS básica.

---

### GATE 5A — Competitor Intelligence V1
* **STATUS**: **PARTIAL**
* **DEPENDENCIES**: GATE 4
* **IMPLEMENTATION**:
  - `0062_competitor_intelligence.sql` con vistas agregadas y función de fallback contextual.
  - Módulo `lib/procurement/competitor-intelligence.ts`.
  - Interfaz de usuario en `app/(internal)/licitaciones/competidores/[ruc]/page.tsx`.
* **VERIFICACIÓN**:
  - Pruebas matemáticas en `scripts/test-competitor-intelligence.ts`.
* **GAPS**:
  - Sin el backfill masivo (Gate 3) y la extracción de ofertas de actas (Gate 4), la interfaz muestra datos mínimos en la base de datos real.

---

### GATE 5B — Cost Engine V1 (Costo Presente Ponderado / CPP)
* **STATUS**: **PARTIAL**
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - `0063_cost_observations.sql`: Tabla de observaciones de costo multi-tenant.
  - Algoritmo en `lib/cost-engine/weighting.ts`: Decaimiento exponencial, atenuación logarítmica y jerarquía de fuentes.
* **VERIFICACIÓN**:
  - `scripts/test-cost-engine.ts` valida el cálculo matemático rigurosamente.
* **GAPS**:
  - No está conectado como listener/trigger reactivo a las facturas y compras que se registran en el ERP. Requiere llamadas explícitas.

---

### GATE 6 — Cost Cold Start / Historical Onboarding
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 5B
* **IMPLEMENTATION**:
  - Parser heurístico de planillas de cómputo en `lib/cost-engine/onboarding.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-historical-onboarding.ts` demuestra que el algoritmo reconoce columnas.
* **GAPS**:
  - No hay pantalla (UI) ni endpoint HTTP para que los usuarios carguen sus archivos Excel/CSV desde la aplicación web.

---

### GATE 7 — Item Matching Engine
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 2, GATE 5B
* **IMPLEMENTATION**:
  - Tokenizador, normalizador de calibres y stopwords en `lib/procurement/item-matching.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-item-matching.ts` valida matching en memoria.
* **GAPS**:
  - No está conectado al flujo de importación de ítems de pliegos en la aplicación.

---

### GATE 8 — Strict Temporal Backtest
* **STATUS**: **INVALID**
* **DEPENDENCIES**: GATE 4, GATE 5A, GATE 5B
* **IMPLEMENTATION**:
  - Script `scripts/test-temporal-backtest.ts`.
* **VERIFICACIÓN**:
  - **FALSIFICADO**: El test corrió sobre un fixture sintético hardcodeado donde los precios de prueba coincidían exactamente con los esperados.
* **GAPS**:
  - No existe un backtesting real sobre una serie temporal histórica independiente de ofertas de la DNCP. La aserción previa de MAPE 0.27% queda anulada como métrica de producción.

---

### GATE 9 — Company Bid Vault
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 0
* **IMPLEMENTATION**:
  - `0064_company_bid_vault.sql`: Esquema de bóveda documental multi-tenant.
  - Lógica de estados de vigencia en `lib/procurement/bid-vault.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-bid-vault.ts` valida transiciones de estado en memoria.
* **GAPS**:
  - No existe interfaz en el ERP para subir, visualizar o renovar documentos de la bóveda.

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
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 9
* **IMPLEMENTATION**:
  - Matriz de evaluación de pliegos en `lib/procurement/compliance-engine.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-compliance-engine.ts` valida la lógica condicional con objetos de prueba.
* **GAPS**:
  - No existe parser que extraiga requisitos de un pliego PDF para alimentar esta matriz automáticamente.

---

### GATE 12 — Institution Intelligence
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 3
* **IMPLEMENTATION**:
  - Algoritmo de scoring de convocantes en `lib/procurement/institution-intelligence.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-institution-intelligence.ts` evaluado sobre objetos mock.
* **GAPS**:
  - No está conectado a un warehouse relacional con datos históricos completos de pagos y contratos estatales.

---

### GATE 13 — Financial Analysis of Tender
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 5B, GATE 12
* **IMPLEMENTATION**:
  - Simulador de flujo de caja y capital de trabajo en `lib/procurement/financial-analysis.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-financial-analysis.ts` valida las ecuaciones de cashflow.
* **GAPS**:
  - No persiste simulaciones en la BD ni se integra con las cuentas bancarias o el flujo de tesorería del ERP.

---

### GATE 14 — Tender Operations Agent V1
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 7, GATE 9, GATE 11, GATE 13
* **IMPLEMENTATION**:
  - Generador de plantillas de formularios en `lib/procurement/tender-operations.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-tender-operations.ts` valida la concatenación de texto de formularios DNCP 1, 2 y 3.
* **GAPS**:
  - Es un generador determinístico de strings markdown, no un agente autónomo interactivo.

---

### GATE 15 — Tender Monitoring Agent
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 14
* **IMPLEMENTATION**:
  - Comparador diferencial en `lib/procurement/tender-monitoring.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-tender-monitoring.ts` valida la detección de cambios entre dos objetos JSON.
* **GAPS**:
  - No hay un proceso en segundo plano (daemon, cron job o worker) que ejecute consultas periódicas contra la DNCP.

---

### GATE 16 — Competitive Simulator
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 5A, GATE 8
* **IMPLEMENTATION**:
  - Simulador estocástico Monte Carlo Box-Muller en `lib/procurement/competitive-simulator.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-competitive-simulator.ts` valida la convergencia matemática y monotonía en memoria.
* **GAPS**:
  - Las distribuciones de probabilidad no están calibradas contra un repositorio masivo de ofertas reales adjudicadas.

---

### GATE 17 — Bid Engine
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 5A, GATE 5B, GATE 12, GATE 13, GATE 16
* **IMPLEMENTATION**:
  - Agregador de 5 pilares comerciales en `lib/procurement/bid-engine.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-bid-engine.ts` valida la regla de Go/No-Go sobre escenarios de prueba.
* **GAPS**:
  - No está integrado en la interfaz de usuario de licitaciones ni persiste sus veredictos en base de datos.

---

### GATE 18 — Bid Analysis Snapshot
* **STATUS**: **PARTIAL**
* **DEPENDENCIES**: GATE 17
* **IMPLEMENTATION**:
  - `0065_bid_analysis_snapshots.sql`: Tabla `bid_analysis_runs` con trigger de inmutabilidad append-only.
  - Módulo `lib/procurement/bid-snapshot.ts` con hashing SHA-256.
* **VERIFICACIÓN**:
  - `scripts/test-bid-snapshot.ts` valida la inmutabilidad y cálculo de hash.
* **GAPS**:
  - La tabla existe pero ninguna acción de usuario o API del ERP escribe registros reales en ella todavía.

---

### GATE 19 — Tender → Project
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 17, GATE 18
* **IMPLEMENTATION**:
  - Función `transformTenderToProject` en `lib/procurement/tender-to-project.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-tender-to-project.ts` valida la transformación de objetos en memoria.
* **GAPS**:
  - No ejecuta transacciones en base de datos; no crea proyectos reales en la tabla `projects` ni inserta ítems en `budget_items`.

---

### GATE 20 — ERP Execution Flywheel
* **STATUS**: **SCAFFOLD_ONLY**
* **DEPENDENCIES**: GATE 19
* **IMPLEMENTATION**:
  - Lógica de retroalimentación de doble bucle en `lib/procurement/flywheel.ts`.
* **VERIFICACIÓN**:
  - `scripts/test-flywheel.ts` valida el recálculo matemático de costos en memoria.
* **GAPS**:
  - No existen event listeners ni webhooks conectados a las acciones de facturas u órdenes de compra del ERP.

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
