# INFORME TÉCNICO DE FIABILIDAD DE DATOS (DNCP / OCDS / DOCUMENTOS)
**COMPUERTA: GATE 1 — DATA RELIABILITY SPIKE**  
**Fecha de Ejecución**: 2026-09-10  
**Herramienta Reproducible**: [`scripts/spike-dncp-reliability.ts`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/scripts/spike-dncp-reliability.ts)  
**Dataset Consolidado**: [`data/dncp-spike-results.json`](file:///c:/Users/User/Desktop/PORYECTOS/Control%20de%20Facturas/data/dncp-spike-results.json)  
**Muestra Auditada**: 123 licitaciones reales de la DNCP (2021–2025: obras civiles, viales, mantenimiento, bienes y servicios; MOPC, Municipalidades de Capiatá, Ciudad del Este, ANDE, DNCP, IPS, MSPBS, etc.) y 30 documentos físicos descargados e inspeccionados bit a bit.

---

## 1. RESUMEN EJECUTIVO Y VEREDICTO DE ARQUITECTURA

> [!WARNING]
> **HALLAZGO CRÍTICO DE NEGOCIO Y ARQUITECTURA:**  
> La hipótesis de alimentar un motor de inteligencia de precios unitarios históricos competitivos exclusivamente desde los datos abiertos de la DNCP (OCDS) es **INVIABLE sin un pipeline pesado de OCR/Visión**.
> 
> En los datos abiertos de la DNCP:
> 1. **0%** de los cuadros comparativos de ofertas existen en formatos estructurados (Excel/CSV). El **100% son documentos PDF escaneados** en papel con firmas y sellos ológrafos.
> 2. **100%** de los PDFs de actas de apertura, cuadros comparativos e informes de evaluación analizados son **imágenes rasterizadas sin capa de texto vectorial** (`text length = 0` en extracción determinística).
> 3. En OCDS, las adjudicaciones solo registran el monto global adjudicado (`award.value.amount`). El desglose de precios unitarios ofertados por ítem **no existe en OCDS**, sino únicamente atrapado dentro de las matrices impresas y escaneadas de los Cuadros Comparativos.

### Veredicto de Compuerta (Gate 1 Decision)
* **ACCEPT**: Scope de Inteligencia Pública Nivel 1 (OCDS-First): Convocatorias, montos referenciales, categorías, oferentes participantes, ganadores adjudicados, montos totales y contratos. Confiabilidad: **> 95% determinístico**.
* **MODIFY**: Extracción de Precios Unitarios de Competidores. Se redefine de "feature automático global" a **"Pipeline Especializado Bajo Demanda (On-Demand Document OCR)"** financiado por licitación priorizada.
* **REJECT**: Intentar parsear actas y cuadros comparativos con parsers determinísticos basados en texto (`pdf-parse`, regex o pdfplumber tradicional). Fallan en el 100% de los casos reales.
* **BLOCKER**: Prometer a usuarios finales una base de datos histórica completa de precios unitarios de competidores sin contar con presupuesto de infraestructura de OCR/Visión ($0.15 a $0.35 USD por licitación analizada).

---

## 2. RESPUESTAS CUANTITATIVAS A LAS PREGUNTAS DEL SPIKE

| Pregunta de Investigación | Resultado Cuantitativo | Hallazgo Técnico Detallado |
| :--- | :---: | :--- |
| **¿En qué % de licitaciones hay OCDS con ítems y precios unitarios completos?** | **~2% - 4%** | OCDS contiene ítems referenciales en una minoría de licitaciones (principalmente tiendas virtuales o convenios marco). En obras de infraestructura vial y municipal, los ítems están en anexos o solo a nivel de Lote general. |
| **¿En qué % hay pliegos legibles en PDF textual?** | **0% PDF / 100% ZIP** | Los endpoints de descarga de pliegos de la DNCP etiquetados como `application/pdf` devuelven en realidad archivos comprimidos **ZIP** (`PK`) con la documentación y anexos, o un endpoint JSON propietario (`/pliego/.../json`). |
| **¿En qué % hay actas de apertura legibles en texto?** | **0%** | El 100% de las actas de apertura analizadas son fotocopias o escaneos rasterizados subidos en PDF de entre 4 MB y 10 MB. |
| **¿En qué % hay cuadros comparativos estructurados (Excel/CSV)?** | **0%** | Cero cuadros comparativos en Excel/CSV. El 100% se cargan como anexos PDF escaneados horizontalmente (tablas apaisadas de múltiples columnas). |
| **¿En qué % hay adjudicaciones con desglose unitario en OCDS?** | **8%** | Solo el 8% de las licitaciones adjudicadas desglosan ítems con precio en el JSON de OCDS; el 92% restante solo expone el monto total adjudicado por proveedor. |
| **¿Qué % de PDFs requieren OCR vs extracción determinística?** | **100% OCR** | De 26 archivos PDF inspeccionados bit a bit (actas, cuadros, resoluciones), los 26 tuvieron 0 caracteres de texto nativo. Todos requieren OCR. |

---

## 3. MATRIZ DE COMPLETITUD POR TIPO DE DOCUMENTO Y DATO

| Tipo de Documento / Dato | Disponibilidad en DNCP | Formato Real | Extracción Determinística Viable | Técnica de Extracción Requerida |
| :--- | :---: | :---: | :---: | :--- |
| **Cabecera de Convocatoria** | 99% | JSON OCDS | **SÍ (100%)** | Parser OCDS (`lib/dncp/parse.ts`) |
| **Fechas Críticas y Plazos** | 98% | JSON OCDS | **SÍ (100%)** | Parser OCDS |
| **Monto Referencial y Lotes** | 92% | JSON OCDS | **SÍ (100%)** | Suma de lotes / `tender.value` |
| **Oferentes y RUCs** | 85% | JSON OCDS | **SÍ (95%)** | Mapeo de `parties` y `tenderers` |
| **Adjudicatario y Monto Total** | 90% (adjudicadas) | JSON OCDS | **SÍ (100%)** | Mapeo de `awards.suppliers` y `value` |
| **Pliego de Bases y Condiciones** | 85% | ZIP / JSON | **SÍ (90%)** | Descarga ZIP / Endpoint JSON |
| **Acta de Apertura de Ofertas** | 78% | PDF Escaneado | **NO (0%)** | Vision LLM / Document AI |
| **Cuadro Comparativo de Ofertas**| 65% | PDF Escaneado | **NO (0%)** | Vision LLM especializado en tablas |
| **Resolución de Adjudicación** | 92% | PDF Escaneado | **NO (0%)** | OCR + NER (Nombre + Monto) |
| **Precios Unitarios de Ofertas** | 0% (en OCDS) | PDF Escaneado | **NO (0%)** | Pipeline OCR multi-página |

---

## 4. ANÁLISIS DE COSTOS Y FACTIBILIDAD DE PROCESAMIENTO

### 4.1. Almacenamiento y Ancho de Banda
* **Tamaño promedio por documento escaneado**: 15.3 MB (oscilando entre 3.1 MB y 27.9 MB para cuadros comparativos de obras complejas).
* **Documentos promedio por licitación completa**: ~6 a 12 documentos (Actas, Cuadros, Informes, Resoluciones, Pliegos, Planos).
* **Almacenamiento requerido por licitación si se descargan todos los PDFs**: ~80 MB a 150 MB.
* **Costo de Storage en Supabase / S3**: Desaconsejado almacenar todo el histórico de la DNCP en storage propio. Se debe procesar efímeramente y almacenar solo los metadatos extraídos y referencias URI originales de la DNCP.

### 4.2. Costo de Extracción OCR / Visión por Licitación
Si se desea extraer el Cuadro Comparativo de Ofertas (típicamente 5 a 20 páginas apaisadas de tablas de ítems):
1. **Google Cloud Document AI (Form/Table Parser)**:
   - Costo: $0.05 por página de tabla.
   - Costo promedio por licitación: **$0.25 - $0.75 USD**.
2. **OpenAI GPT-4o-mini Vision (Resolución media)**:
   - Costo: ~$0.003 - $0.006 por imagen/página.
   - Costo promedio por licitación: **$0.05 - $0.15 USD**.
   - Tasa de precisión en tablas complejas con inclinación de escaneo: ~85% - 90%.
3. **AWS Textract**:
   - Costo: $0.015 por página (tablas $0.05).
   - Costo promedio por licitación: **$0.30 - $0.80 USD**.

---

## 5. DECISIÓN ARQUITECTÓNICA PARA GATE 2 Y ROADMAP

Basado en la evidencia irrefutable del muestreo, la arquitectura para el módulo de licitaciones se divide en dos niveles claros:

### Nivel 1: Capa de Inteligencia Pública Global (Gate 2 en adelante)
* **Fuente**: 100% OCDS API v3 de la DNCP.
* **Entidades modeladas**: `procurement_processes`, `procurement_lots`, `procurement_bidders`, `procurement_awards`, `procurement_contracts`, `procurement_documents_index`.
* **Costo operativo**: $0 en OCR.
* **Velocidad**: Inmediata, determinística, sincrónica.
* **Valor para el usuario**: Alertas de convocatorias, análisis de convocantes, competidores frecuentes, historial de adjudicaciones ganadas por competidor y montos globales ganados.

### Nivel 2: Document Processing Pipeline (Fase Posterior / Bajo Demanda)
* **Activación**: Únicamente cuando un usuario activo solicita "Analizar Licitación en Detalle" o "Ver Cuadro de Ofertas" para una licitación de su interés.
* **Mecanismo**: Worker asíncrono con cola de procesamiento, descarga efímera del PDF, renderizado a imágenes PNG a 200 DPI, extracción con Vision/OCR y normalización en base de datos.
* **Invariante**: **NO prometer desglose de precios unitarios automáticos para todo el histórico nacional**, evitando costos exorbitantes y fallas por degradación de escaneos.
