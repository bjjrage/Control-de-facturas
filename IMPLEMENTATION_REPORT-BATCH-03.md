# BATCH 03 — RFQ 2.0 FULL AUTOPILOT

## Estado

**STATUS: COMPLETE.** Rama `batch/03-rfq-2-core`, con base `53898dffe0a47a517bfeb31722af2f633a31486f`. Implementado y verificado en una Preview aislada. No se abrió PR ni se hizo merge.

## Schema y migrations

- Se incorporó el baseline DB-INFRA validado en un commit separado. El archivo SQL conserva SHA256 `A532E54FB9C3D9A10C4CC2A68C5247057D71DC70D62EA4F4AD2B91B6723C32C5`.
- Las 148 migrations históricas se archivaron byte por byte con sus SHA256 registrados. No se editaron migrations históricas.
- El modelo de trabajo usa `rfqs → rfq_items → rfq_providers → quotes → quote_versions → quote_version_items`; no reactivó tablas legacy.
- `rfqs.purpose` es nullable, sin default; los RFQs nuevos exigen elección explícita `COST_DISCOVERY` o `PROCUREMENT`, sin inferencias ni backfill.
- Las seis migrations funcionales se aplicaron y validaron solo en Preview:

| Versión | SHA256 |
| --- | --- |
| `20261003000341` | `ACB43BA7AC4A364A0A384D24DB217E5D010DBF53D2142B3BDAD4A967A0F6DD01` |
| `20261003004948` | `AF3A03A380DAF1BCFA8790DDEC1504E588336FCB9653496F8B922639C821B312` |
| `20261003010730` | `A5AF75396B7B42DC158BCD60F67CA5960FC523ADDF0F04ED574B3AD8104199B5` |
| `20261003011539` | `B68890A16572DADCFDE182D7B8BE63040903A6CE6CDCD13D93838AA455E567BC` |
| `20261003012030` | `437D5276B915E7DF4EC9CDC13084A1F7764C8FF93958A6999321A84D36EF1D2E` |
| `20261003012927` | `C5F741B06D20156A5084DC467334213C88701B116C9500943CAA58F2DBF070F9` |

Una vez aplicadas, las seis migrations no se modificaron. El ledger de Preview contiene siete entradas contando el baseline `20261002231537`.

## Flujo implementado

- **PURPOSE:** elección humana explícita al crear RFQ; históricos pueden permanecer `NULL`.
- **MAGIC LINK:** token aleatorio de 256 bits, vencimiento, revocación/rotación, aislamiento por empresa y proveedor, página sin referrer y sin caché. La entrega del enlace queda a cargo del usuario; no se configuró envío de correo.
- **QUOTE VERSIONING:** las respuestas/correcciones agregan versiones; no sobrescriben la evidencia o hechos originales. La versión vigente se selecciona explícitamente para revisión.
- **RECONCILIATION:** conserva oferta estructurada y documento original; destaca diferencias para revisión humana sin corregir datos silenciosamente. Acepta XLSX, PDF y archivos de imagen dentro de límites de tipo/tamaño. XLSX y texto PDF se extraen como datos revisables; imágenes/escaneos requieren transcripción humana.
- **COMPARATIVE:** compara por ítem/proveedor precio, moneda, impuesto, flete, disponibilidad, plazo, vigencia, pago, evidencia y discrepancias. No inventa conversión cambiaria.
- **PROPOSALS:** ofrece ocho escenarios, incluido menor precio, proveedor único, lotes, entrega, términos, ponderado, custom y parcial. Son propuestas; no adjudican. Términos en prosa requieren valoración humana.
- **HUMAN ALLOCATION:** valida empresa, RFQ/proveedor participante, quote y versión vigente, disponibilidad, cantidades no negativas/no excedidas y precisión; permite parciales y cantidades sin asignar. La acción vuelve a leer los hechos desde DB.
- **AUTHORIZATION:** acción explícita separada y justificación humana persistida. Guardas de servidor impiden alterar el origen de una OC confirmada.
- **OC PREVIEW:** el servidor calcula snapshot/hash exacto con proveedor, ítems, cantidades, precio, moneda, impuestos, términos, totales y origen RFQ/quote/version. No crea OCs.
- **OC GENERATION:** checkbox de confirmación humana revalida el snapshot y crea de manera idempotente de una a N OCs. Las pruebas reales crearon dos OCs para una asignación 4+5.
- **COST_DISCOVERY:** cierre explícito; no genera OCs.
- **PROCUREMENT:** oferta → comparación/propuesta → allocation humana → autorización humana → preview → confirmación humana → OCs.
- **DIRECT PURCHASE / MRP:** compra directa permanece separada y no crea RFQ; preview exacto y confirmación humana. Need-to-Buy permite elegir `COTIZAR` o `COMPRA DIRECTA`, nunca muta automáticamente.
- **PRICING INTEGRATION:** la cotización alimenta `cost_observations` como señal `COTIZACION`; no se presenta como compra efectiva ni se adopta automáticamente. La adopción humana valida la quote vigente y toma el precio factual desde DB. La lógica cerrada de Batch 02 se preservó.

## Seguridad y pruebas

- Aislamiento tenant comprobado con usuarios autenticados reales en Preview. Lecturas anónimas y escritura directa de asignación bloqueadas; RPCs de proveedor restringidas a `service_role`; empresa ajena no puede previsualizar, autorizar, confirmar ni cerrar.
- La revisión de Security Advisor no detectó bloqueos de permisos RFQ nuevos. Persisten avisos preexistentes de funciones/vistas legacy fuera del alcance de este batch.
- Flujo real de navegador sobre el build de producción local y datos sintéticos de Preview: RFQ, invitaciones, link seguro, documentos/versiones, adopción manual, reparto, autorización/preview/confirmación, COST_DISCOVERY y compra directa; PASS.
- Tests enfocados RFQ/costing/procurement: 112/112 PASS.
- Suite serial completa `npx vitest run --maxWorkers=1`: 1,345 PASS / 16 skipped (150 test files PASS, 2 skipped).
- `npx tsc --noEmit`: PASS.
- `npx next build --webpack`: PASS con Next.js 16.3.1; 58 rutas estáticas generadas.

## Preview y producción

- Preview: `batch-03-rfq-2-validation`, branch UUID `2325db99-ecb4-4e66-991e-57ff21fbbfb3`, project ref `afedslxxtttyqunqmutz`, creada sin datos productivos. Estado actual `ACTIVE_HEALTHY`.
- Replay: 7 migrations registradas. Existen las nueve relaciones verificadas: `projects`, `budget_items`, `rfqs`, `rfq_items`, `rfq_providers`, `quotes`, `quote_versions`, `quote_version_items`, `project_cost_prices`.
- **Producción no modificada.** Verificación de solo lectura: ledger contiene únicamente baseline `20261002231537`; `public.rfqs.purpose` no existe en producción. No se ejecutó SQL de aplicación en producción.

## Cierre

No hay bloqueadores funcionales dentro del alcance. Requieren decisión/acción humana la selección de escenarios, adjudicación/asignación, autorización, confirmación de OC y revisión de discrepancias; esto preserva los invariantes congelados. La distribución del magic link es manual. No abrir PR ni mergear desde este batch.
