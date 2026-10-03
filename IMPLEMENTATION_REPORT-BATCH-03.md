# BATCH 03 — RFQ 2.0 FULL AUTOPILOT

## Estado

**STATUS: READY FOR EXTERNAL MERGE AUDIT.** Rama `batch/03-rfq-2-core`, con base `53898dffe0a47a517bfeb31722af2f633a31486f`. Implementación, hardening y verificación final completados en Preview aislada. Producción no se modificó. Abrir PR contra `main`; no mergear.

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
| `20261003025110` | `C9B061601E315E7DB88E8D4EB28FD3236BBF10B5D03F0488B42218DE523B9F0A` |
| `20261003030227` | `8C62C7256452DFE0A359B9ECE3BEBAF15EE68AFF72A227D0501699DB510A62EB` |

Las seis migrations originales se mantuvieron inmutables. Las dos migrations de hardening también quedaron inmutables después de aplicarse a Preview: la primera reemplaza MD5 por SHA-256 sobre el payload JSON determinístico de órdenes; la segunda cierra la carrera de rotación/revocación de magic links tomando locks en orden RFQ → invitación y releyendo el token bajo lock. El ledger de Preview contiene nueve entradas contando el baseline `20261002231537`.

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

- Aislamiento tenant comprobado con usuarios autenticados reales en Preview. Lecturas anónimas y escritura directa de asignación bloqueadas; RPC de proveedor restringida a `service_role`; usuario de otra empresa no puede previsualizar ni confirmar una asignación ajena.
- Prueba adversarial de Preview: confirmaciones concurrentes producen una sola OC por proveedor/línea/moneda; reintento secuencial devuelve el mismo conjunto de IDs; no hay duplicados ni escrituras parciales. El hash es SHA-256 hex de 64 caracteres y coincide con `extensions.digest` sobre el payload canónico.
- `COST_DISCOVERY` rechazado server-side en `rfq_save_allocation`, `rfq_authorize_allocation`, `rfq_preview_orders` y `rfq_confirm_orders`, incluso con allocation autorizado sintético insertado directamente.
- Pruebas cross-tenant cubren RFQ/proveedor, quote item, adjunto/invitación, allocation/version item, preview y confirmación; todos los cruces fallan cerrados.
- Magic links: token de 256 bits, expiración, revocación y rotación; token anterior rechazado tras rotación; cierre de RFQ y proveedor inactivo bloquean submit; adjuntos deben pertenecer a la misma empresa e invitación. El portal responde `no-referrer` y `no-store`/`no-cache`; las pruebas no imprimen tokens.
- Security Advisor actualizado: cero funciones RFQ con ejecución `anon`. Diez RPC RFQ intencionalmente disponibles para `authenticated` aparecen bajo el linter genérico SECURITY DEFINER; derivan actor del perfil autenticado y validan empresa/estado/recurso. Los intentos anónimos y cruces de tenant fueron rechazados. No se detectó bypass RFQ nuevo.
- Findings preexistentes fuera de scope: 4 tablas RLS sin policy (`auction_sandbox_room_private`, `email_send_attempts`, `receipt_portal_links`, `scan_pin_attempts`); 2 vistas SECURITY DEFINER (`v_procurement_competitor_contextual`, `v_procurement_competitor_global`); 15 funciones con `search_path` mutable; 49 funciones SECURITY DEFINER ejecutables por anon y 79 por authenticated en total; protección de contraseñas filtradas de Auth deshabilitada. Incluye legacy de la aplicación y no se modificó en este batch.
- Flujo real de navegador sobre build local y datos sintéticos de Preview: RFQ, invitaciones, XLSX original, corrección/versionado, conciliación humana, adopción factual desde DB, reparto, autorización/preview/confirmación, COST_DISCOVERY sin compra y compra directa con cantidad fraccional; PASS.
- Tests enfocados RFQ/costing/procurement: 112/112 PASS.
- Suite serial completa `npx vitest run --maxWorkers=1`: 1,345 PASS / 16 skipped (150 test files PASS, 2 skipped).
- `npx tsc --noEmit`: PASS.
- `npx next build --webpack`: PASS con Next.js 16.3.1; 58 rutas estáticas generadas.

## Preview y producción

- Preview: `batch-03-rfq-2-validation`, branch UUID `2325db99-ecb4-4e66-991e-57ff21fbbfb3`, project ref `afedslxxtttyqunqmutz`, creada sin datos productivos. Estado observado durante pruebas: `ACTIVE_HEALTHY`.
- Replay: nueve migrations registradas: baseline, seis RFQ originales y dos hardening migrations. Existen las nueve relaciones verificadas: `projects`, `budget_items`, `rfqs`, `rfq_items`, `rfq_providers`, `quotes`, `quote_versions`, `quote_version_items`, `project_cost_prices`.
- Smoke SQL en Preview terminó `PASS`; usa `BEGIN ... ROLLBACK`. Verificó SHA-256 real, dos OCs confirmadas, retry idempotente por conjunto de IDs, ninguna OC antes de confirmar y bloqueo de las cuatro acciones de compra para `COST_DISCOVERY`.
- **Producción no modificada.** Verificación de solo lectura: ledger contiene únicamente baseline `20261002231537`; `public.rfqs.purpose` no existe en producción. No se ejecutó SQL de aplicación en producción.

## Cierre

No hay bloqueadores funcionales dentro del alcance. Requieren decisión/acción humana la selección de escenarios, asignación, autorización, confirmación de OC y revisión de discrepancias; esto preserva los invariantes congelados. La distribución del magic link es manual. Publicar la rama y abrir PR contra `main`; queda prohibido mergear antes de la auditoría externa.
