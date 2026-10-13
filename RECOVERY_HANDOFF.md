# Handoff de recovery — PARCIAL

## Ofertas en filas compactas — revisión posterior del 12/10/2026

El propietario rechazó los grandes cards y pidió comparación vertical con contraste. Commit local `f36fe01ba1d8ccc8a9adb97a531b5634341b245e` modifica sólo `purchasing-offers.tsx` y su CSS: tabla compacta, una fila por proveedor; total, precio unitario, entrega, disponibilidad, pago y acciones alineados. Fondo pizarra claramente más claro que la página, encabezado diferenciado, filas alternadas y hover. Selector por menor total (predeterminado), menor entrega o mayor disponibilidad/cobertura. Precio se compara dentro de una moneda, priorizando cobertura completa y ofertas utilizables; ordenar no selecciona ni autoriza proveedores.

UI real: RFQ-0005 muestra A 10.100 PYG arriba de B 50.100 PYG; Adjudicar B abre su diálogo de 50.100 PYG / crédito 120, cerrado sin guardar. RFQ-0007 existente muestra B primero por precio (49.000 frente a 50.500), A primero por entrega (2 frente a 5 días); selector de disponibilidad comprobado con ambas coberturas de 100 kg. Sin nuevas ofertas, revisiones, asignaciones, OCs ni SQL en esta iteración. Flujo del diálogo/RPC no modificado.

Typecheck y lint focal PASS; diff limpio. Los 47 tests y E2E de emisión registrados más abajo conservan el SHA anterior `12ded69`; no se repitió emisión ni suite en esta iteración visual. Ambos archivos reflejados en runtime aislado `../erp-before-live`; localhost:3002 continúa activo. Captura actual: `../recovery-ofertas-filas.png`. Sólo recovery, sin integración ni producción. Las secciones siguientes describen las iteraciones reemplazadas.

## Panel simplificado anterior — 12/10/2026, 21:10 Paraguay

Esta actualización reemplaza el tratamiento visual anterior rechazado por el propietario. Sólo se modificaron `administrative-rfq-detail.tsx`, `purchasing-offers.tsx` (nuevo) y `procurement-panel.module.css`, en `erp-recovery`, rama `recovery/compras-ventas-approved`. Commit local de código: `12ded69c4e6171a2410ad6c694e9f867ea9d3dd6`. Los tres archivos se reflejaron en el runtime desechable `../erp-before-live`; preview `http://localhost:3002`, Supabase aislado `kyiihlkncatojvlasoag`, proceso Next observado 17588.

Administración muestra una tarjeta por proveedor: total, precio unitario, entrega, disponibilidad, pago, documento original y Adjudicar. Se restauraron los colores originales de la app y la jerarquía usa tipografía, espacio, bordes y hover. Se retiraron de esta superficie las comparativas duplicadas, ponderaciones, puntajes, escenarios repetidos, texto crudo y formularios técnicos de extracción. Invitaciones/datos de solicitud quedan plegados. Costeo conserva su recorrido separado.

Adjudicar abre un diálogo corto para revisar la oferta elegida, elegir un motivo comercial, guardar selección, autorizar y confirmar la preview exacta. Las discrepancias o ausencia de evidencia siguen exigiendo aclaración humana. Cantidades y reparto entre proveedores siguen disponibles como controles opcionales. Se reutilizan acciones, lector, análisis y RPC existentes; no cambios de contratos DB ni adjudicación automática. Una compra emitida muestra su OC y deja de ofrecer edición de adjudicación.

E2E real por UI en la base aislada, sin precargar hechos documentales, revisiones ni asignaciones:

- RFQ-2026-0007 (`67133fd7-be78-49f7-b290-7cc4713f5623`), 100 kg de Arena sintética. Dos proveedores ficticios enviaron oferta estructurada y Excel original desde Magic Links en Chrome externo. Extracción y contraste automáticos.
- A: 50.500 PYG, entrega 2 días. B: 49.000 PYG, entrega 5 días, Contado. Se eligió B desde su tarjeta, se confirmó explícitamente su revisión y se seleccionó el motivo Precio conveniente.
- Selección guardada → autorización humana → preview 100 × 480 = 48.000 PYG con IVA incluido + flete 1.000 = 49.000 → confirmación explícita → **OC-2026-0003** (`e0a100b4-6da9-48b6-9824-668048ecf64e`), AUTORIZADO.
- SELECT de sólo lectura confirmó cero órdenes para esa RFQ antes de la confirmación y exactamente una después. El botón Ver OC-2026-0003 abrió la página real de la orden. No se agregó recepción ni factura.
- RFQ-2026-0001, V-00001 y RFQs del propietario preservadas. RFQ-2026-0005 permanece OFERTAS_RECIBIDAS, sin registrar revisión ni adjudicación. Su pago histórico `30` se presenta como Crédito a 30 días sin reescribirlo.

Validación: typecheck final PASS; lint de los componentes modificados PASS; 47 tests focales PASS (`creation-recovery`, `actions`, `domain`, `automatic-analysis`); diff sin errores. No se ejecutó build completo de este SHA. Capturas en el directorio padre: `recovery-arena-panel-simple.jpg` (RFQ del propietario), `recovery-ofertas-simples.jpg` (dos ofertas) y `recovery-confirmacion-simple.jpg` (preview final).

Sin cambios en main, producción, esquema, SQL correctivo, dependencias, push o despliegues. Preview encendida para revisión del propietario; integración pendiente. Estado global PARCIAL: no certifica múltiples OCs en una asignación, OCR, ciclo completo de Ventas ni atribución histórica exacta. Las secciones siguientes conservan evidencia anterior, no describen la interfaz vigente.

## Panel anterior, reemplazado por la simplificación — 12/10/2026, 20:00 Paraguay

Cambios solicitados por el propietario, aplicados sólo en `erp-recovery`, rama `recovery/compras-ventas-approved`, y reflejados en la preview `http://localhost:3002`: paneles neutros, títulos y etapas numeradas, acción visible para revisar/adjudicar, propuestas avanzadas plegadas, hover/focus, subida del original mediante botón compacto, botones con iconos para copiar/QR/WhatsApp/ver documento y condiciones Contado / Crédito a 30, 60, 90, 120, 160 o 180 días. Se conserva el contrato de texto `payment_terms` y todas las guardas humanas/RPC actuales.

El error técnico de PDF observado en la RFQ-2026-0005 era `Object.defineProperty called on non-object`. La copia desechable histórica `erp-before-live` no tenía la configuración de `pdf-parse` ya existente en esta rama. Se copió su `next.config.ts` con externalización/tracing al runtime; Next reinició (PID observado 17588). No se escribió otro parser ni se modificaron dependencias. El PDF de esa RFQ ya se lee, pero no identifica datos de Arena: el panel conserva la ausencia de evidencia y exige revisión/justificación. No se registró revisión ni adjudicación en esa RFQ del propietario.

Prueba completa del panel nuevo mediante UI real y portal Chrome externo, sin hechos extraídos precargados:

- RFQ-2026-0006 (`e1c44e5f-b65b-4158-a557-5a0a2e1eb04a`), producto sintético, 2 bolsas y proveedor ficticio A. Botones Copiar y QR comprobados; WhatsApp no se envió.
- Original Excel sintético con 20.000 PYG frente a oferta estructurada de 21.000 PYG. La extracción y discrepancia aparecieron automáticamente al enviar y al abrir Administración. Subida con el botón nuevo y selección Crédito / 160 días desde los controles nuevos.
- Revisión humana justificada → Elegir proveedor → Guardar adjudicación → autorización explícita → preview → confirmación. Total 46.700 PYG: base 42.000 + IVA 4.200 + flete 500.
- UI confirmó OCs emitidas. SELECT sólo lectura en `kyiihlkncatojvlasoag` confirmó **OC-2026-0002** (`78526982-055b-4bd6-bd0e-5a0c2307f508`), AUTORIZADO, 46.700 PYG y snapshot `Crédito a 160 días`.
- SELECT confirmó RFQ-2026-0001 BORRADOR, V-00001 BORRADOR / 5.500.000 PYG y RFQ-2026-0005 OFERTAS_RECIBIDAS. No limpieza, reset ni SQL correctivo. RFQs Arena del propietario preservadas.

Validación actual: typecheck PASS; 40 tests focales PASS (`creation-recovery`, `actions`, `domain`); lint focal PASS; `git diff --check` PASS. No se ejecutó un build completo después de estos cambios: los resultados de build/suite general más abajo corresponden al SHA histórico allí indicado. Capturas locales en el directorio padre: `recovery-panel-jerarquia.jpg` y `recovery-adjudicacion-credito160.jpg`.

Código guardado en commit local `e697fe9e471f01be64948a6d041b0293fbcae01b`. La preview queda funcionando para revisión. Integración pendiente de aprobación del propietario; sin push, PR, merge, despliegue, migración ni cambios productivos. El estado global sigue PARCIAL por los alcances de múltiples proveedores/OCs, OCR, Ventas completo y atribución histórica ya documentados. Las secciones siguientes conservan evidencia de etapas anteriores; los bloqueos de stack/E2E anteriores quedaron superados para los dos ensayos de Compras aquí registrados.

## Actualización de preview — 12/10/2026, 19:23 Paraguay

El propietario confirmó la interfaz histórica visible: «acabo de ver.. esto si corresponde». Se conserva esa superficie de Administración, tomada de `a61c6550`, y se conecta a las acciones/RPC actuales. No equivale a restaurar sin cambios todo ese commit.

Cambios locales sin commit en `erp-recovery`: formulario administrativo separado de Costeo, entradas de creación y detalle histórico de Compras con revisión documental, propuestas, autorización, preview y confirmación actuales. El formulario declara `PROCUREMENT` para nuevas compras; no reclasifica históricos ni elimina guardas MRP. Corrección del error observado «purpose explícito obligatorio» demostrada creando RFQ-2026-0002 desde el formulario real. Testigo `erp-before-rfq2` intacto.

Preview activa: `http://localhost:3002`, proceso Next 16724, ejecutada en copia desechable `../erp-before-live` del testigo con los adaptadores de esta rama. Port 3001 sigue sirviendo el build anterior y no acredita estos cambios. Mantener 3002 mientras el propietario revisa. La configuración aislada valida URL y claves contra Supabase `kyiihlkncatojvlasoag` / `recovery-compras-ventas-20261012`; rama paga autorizada expresamente. No se ejecutó SQL correctivo, migración ni operación productiva en esta actualización.

E2E real de un proveedor / un ítem, mediante UI y DB/Storage aislados:

- RFQ-2026-0002 (`846486c3-36e9-4d1f-afc0-f4dd766334dc`), 3,5 bolsas; invitación desde Administración y Magic Link abierto en Chrome externo.
- Oferta estructurada 16.000 PYG + Excel sintético original con 15.000 PYG; análisis automático al enviar y al abrir Administración. No se precargaron hechos, revisiones, asignaciones ni extracción mediante SQL o mocks.
- UI mostró precio extraído 15.000 y discrepancia con 16.000, además de diferencia de representación de vigencia. Revisión justificada por UI; oferta original preservada.
- Propuesta editable → asignación guardada → autorización explícita → preview de 61.600 PYG (56.000 + 5.600 IVA) → confirmación → OC-2026-0001 (`fce6d32a-93db-4e00-9f81-19c2fb4d0b32`). SELECT y listado UI confirmaron una OC autorizada de esa RFQ. No se enviaron mensajes a terceros.
- RFQ-2026-0001 sigue BORRADOR; V-00001 sigue BORRADOR / 5.500.000 PYG. RFQ-2026-0003 Arena creada por el propietario no fue modificada. No reset ni limpieza de fixtures.

Validación de los cambios: typecheck PASS; 16 tests focales PASS; lint de los cuatro archivos nuevos/modificados de formulario y rutas PASS. Lint ampliado conserva el error previo de ref durante render en `rfqs-section.tsx` y dos warnings de imports previos; allí sólo cambió la importación del diálogo. `git diff --check` PASS.

Alcance pendiente: este ensayo no prueba múltiples proveedores/OCs, OCR de escaneos/imágenes ni el ciclo completo de Ventas. El lector existente no incluye OCR y no se construyó otro parser. Se observa duplicación visual de discrepancias al combinar análisis derivado y revisión guardada; no altera el original. La navegación de «Ver órdenes» necesitó apertura directa de `/orders` en el ensayo; no se declara ese enlace verificado. Estado global continúa PARCIAL.

El trabajo queda local en `recovery/compras-ventas-approved`. No push, PR, merge, deploy ni operaciones productivas. La infraestructura de preview temporal fue autorizada posteriormente por el propietario, como se registra arriba. La auditoría SENTINEL y su SHA congelado no fueron retomados ni certificados.

## Copias y referencias

Directorio padre: `C:/Users/User/.codex/visualizations/2026/10/12/01a130f7-9ff0-7490-9a7a-97c7ad71bc0e`.

- `erp-before-rfq2`: rama `recovery/erp-before-rfq2`, HEAD `a61c6550e21e5fd12f6655e1a382b346305221dc`, árbol `e657315797afe49559cea269d2eb60fb3e45e6e0`, limpio e intacto. Sin instalación/ejecución.
- `erp-base`: detached `953ebba505b38313bd3e18e6cb9fbf31b7e1eb89`, código limpio, utilizado para reproducción con fixtures.
- `erp-recovery`: rama de implementación desde ese mismo main. `git log -3 --oneline` identifica los commits locales; `RECOVERY_CHECKPOINT.json` fija el commit de código validado. El commit de handoff puede ser posterior sin cambios de aplicación.
- Carpeta del usuario: `C:/Users/User/Desktop/PORYECTOS/Control de Facturas`, rama `fix/qa-admin-remediation-3`, HEAD inicial `ccddbe33ab476d2662dfc139b7a859b51a06876f`. No checkout ni limpieza. Staged/unstaged de código inicialmente vacíos; archivos no versionados concentrados en auditoría/evidencia/ejemplos. No se agregaron al recovery.
- Las ramas previas `recovery/erp-functional-rebuild` y `recovery/restore-legacy-surface-contract`, y worktrees del auditor/usuario, permanecen sin modificar.

Base y recovery reutilizan `node_modules` instalado mediante junction; no copiaron `.env`, credenciales ni datos. No se cambiaron dependencias, lockfile, versión de framework o configuración global de Git. Las copias se ubicaron fuera del repositorio para evitar que sus globs recorran informes/código congelado.

Commits locales de aplicación:

- `873f030d63687365e22c043e8cac24a50309a6a5`: conservación de formularios Compras/Ventas, contexto RFQ y recuperación ante upload parcial.
- `e39c12b348793d0a6f213df825deddd16b8c6112`: controles RFQ/documentos, análisis automático al enviar y al abrir Administración, propuestas preliminares y guardas humanas. **SHA de código validado.**

El commit posterior contiene sólo handoff, checkpoint, harness y evidencia seleccionada. No cambia aplicación. Testigo y BASE se verificaron limpios; checkout original conserva HEAD y staged/unstaged de código vacíos.

## Verificación

Ejecutar desde `erp-recovery`:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/vitest/vitest.mjs run --maxWorkers=1
node scripts/recovery/forms-browser.cjs ../erp-base recovery-evidence/base-browser
node scripts/recovery/forms-browser.cjs . recovery-evidence/recovery-browser --expect-pass
```

La suite general de `vitest.config.mts` excluye suites externas; resultados finales y conteos en checkpoint/evidencia. BASE focal: 7 archivos, 90 tests PASS (RFQ/cotización/post-OT/procedencia).

Compilación local usada:

```powershell
$env:NEXT_TELEMETRY_DISABLED='1'
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='test-only-no-access'
$env:SUPABASE_SERVICE_ROLE_KEY='test-only-no-access'
$env:OPENAI_API_KEY=''
$env:DEEPSEEK_API_KEY=''
node node_modules/next/dist/bin/next build --webpack
```

Son claves ficticias no operativas y destino loopback sin stack. Build no demuestra conectividad DB ni ejecución de un worker. Se usó webpack por la junction local; no se cambió el script del proyecto. Sobre el código final: **build PASS, typecheck PASS, 194 archivos / 2.140 tests PASS; 2 archivos / 16 tests SKIP**. La primera corrida simultánea de `tsc` y build colisionó con regeneración de `.next/types` (TS6053); `tsc` se repitió después del build y pasó. No se modificó código/configuración para ocultarlo. Logs finales y `checks.json` fijan el resultado.

Lint amplio de RFQ/Ventas/portal en BASE: **4 errores, 9 warnings**. Los errores son `Date.now` directo en render de detalle/workspace, ref en render de `rfqs-section.tsx`, y `any` explícito de `rfq/service.ts`. Comparación en `base-lint.log`. Recovery corrige los tres que están en archivos intervenidos usando contratos/helpers existentes y tipo inferido. No modifica el AppShell/listado global para limpiar el cuarto. Lint de archivos modificados se registra por separado; no se oculta el fallo amplio preexistente.

Evidencia navegador: Chromium y Firefox, 1440×1000 y 390×844, 36 casos PASS. Componentes reales + acciones sintéticas; análisis Excel usa lector/extractor/contraste reales con DB/Storage simulados. Se aserta precio documental preparado 15000 frente a oferta 16000 sin rellenar hechos extraídos ni ejecutar botón de extracción. No es E2E contra Supabase. Capturas usan CSS mínimo; no acreditan equivalencia visual del producto.

## Contrato de Administración y reconexión

La corrección prioritaria del propietario confirma la aprobación del 1/10: RFQ → Magic Link → oferta estructurada + documento → análisis/contraste automáticos → comparativo/propuestas → humano revisa/selecciona/autoriza → preview/confirmación → 1..N OCs. `ManualQuoteDialog`/`fb5af6c` son evidencia de Operativo/Costeo, no del límite de Administración.

BASE contenía la cadena `extractQuoteDocumentAction → readDocumentContent → extractDocumentFacts → reconcileOffer`, pero el envío no la llamaba y el workspace esperaba un botón manual. Recovery reutiliza esa cadena en `document-analysis.ts` desde el submit externo/interno después de confirmar versión y desde el detalle autorizado. El workspace recibe los hechos preparados; reintento manual sólo ante fallo. Las propuestas preliminares no crean `review_id` y no habilitan asignación sin revisión humana.

No se localizó en Git el caller automático original de la aprobación: se reparó el cableado actual según el contrato explícito, sin afirmar que se encontró/restituyó un commit histórico exacto. Consultas `git log --all -G`, historial del lector, antecedentes `9d8d87d`, `fb5af6c`, `a61c655`, `b269e0d` y reporte Batch 03 delimitan esa evidencia. Ver `document-history.txt`.

El análisis es derivado: se ejecuta al enviar y se recalcula al abrir Administración. Sólo la revisión humana persiste extracción/comparación mediante `rfq_review_quote`. No existe en el contrato inspeccionado una tabla de análisis automático; no se inventó una revisión para usarla como caché ni se creó migración. Fallo después del commit devuelve oferta enviada + análisis pendiente, evitando reenvío inducido por éxito ficticiamente fallido.

## Compatibilidad preservada

- Contratos RFQ actuales y guards DB; asignación/revisión/autorizar/preview/hash/confirmar OC; COST_DISCOVERY sin compra.
- Tenant/actor/permisos, tokens vigentes/revocados, originales, checksum y versiones.
- Stock/recepción canónicos y contratos de precisión propios.
- Las tres migraciones Remediation 3 y sus adapters de app/worker, numeric 4 decimales para conciliación y RPCs/atomicidad; cero migraciones nuevas o modificadas.
- Ventas: portal separado `/cotizacion/[token]`, aceptación/snapshot/OT, documentos derivados de `04e1d57` y guards posteriores, cobros/reversas y controles fiscales.

## Bloqueos esenciales y siguiente paso

1. **Cobertura completa de PDF libre/fotos/escaneos y atribución histórica del trigger**: aprobación confirmada por propietario, no falta recordar pantallas. No se localizó el caller original ni otra conexión de OCR/mapeo de presupuestos proveedor que demuestre esos formatos. El motor actual leído no certifica esa capacidad: Excel con descripciones únicas sí; texto PDF RFQ busca IDs; imágenes/escaneos quedan sin hechos. No declarar capacidad inexistente ni recuperada. Localizar código/conexión/prueba original; no usar parsers de facturas/obra/DNCP como sustituto ni transcripción manual como cierre.
2. **E2E con persistencia real**: no hay Docker/Podman disponible en PATH, instalación Docker conocida ni servicios Supabase locales detectados (Auth/Storage/PostgREST/DB, puertos 5432/54321/54322/54323/8000/3000). CLI Supabase sí está instalada; su consulta status en sandbox falla primero al escribir telemetría en perfil, por lo que no acredita estado del stack. Existen binarios PostgreSQL de la auditoría, pero no equivalen al stack; pgdata no se tocó. No se usó remoto como sustituto. Reutilizar un entorno descartable compatible y ejecutar A–J desde rutas reales: entrada obra, compartir por UI, sesión externa, oferta/documento sin hechos extraídos precargados, stock/factura/matching/pago, cliente→OT→documentos/cobro, readback y concurrencia.
3. **Históricos sin líneas/propósito y links anteriores**: lectura de documentos recuperada; operaciones que requieren líneas/propósito siguen bloqueadas. Cualquier adaptación persistente necesita contrato y autorización puntual. No recrear documentos ni backfillear para esconder el problema.
4. **Equivalencia aprobada de todas las superficies**: comparación fuente realizada; última aprobación visual por capacidad y comparación dinámica histórica no están verificadas. Contrastar con propietario/coder sobre este recovery, sin certificarlo automáticamente para producción.

La pérdida de campos fue reproducida con errores sintéticos en BASE. **El error exacto del envío reportado por Marcelo no está identificado**: necesita request/error y persistencia del recorrido real aislado. El mismo agente implementó y revisó los cambios; no hay afirmación de revisión independiente.

Consultar `RECOVERY_MAP.md` para tratamiento por capacidad y `RECOVERY_CHECKPOINT.json` para estado exacto, comandos y siguiente acción. Continuar aquí; no crear otro baseline ni rediseño global.


## Facturas: IVA y Storage de preview ? 12/10/2026

Pedido visual registrado para el futuro refactor: conservar la jerarqu?a del detalle de OC mostrado por el propietario; todos los cards deben tener hover y bordes m?s gruesos, claramente contrastantes con su superficie. Se admiten acentos fl?or o met?licos. No aplicar un redise?o global ahora; alcance de migraci?n: Compras y Ventas.

OC-2026-0005 (c4268f21-2fc5-4e8f-9ea1-af28fbc289ae), Proveedor Ensayo Integral, 100 kg de Arena, 100.000 PYG IVA incluido, emitida mediante RFQ-2026-0008. No hab?a facturas al verificar el detalle.

Se cre? ?nicamente el bucket privado invoice-files en kyiihlkncatojvlasoag, l?mite 20 MB, PDF/JPEG/PNG/WEBP, mediante Storage API; no SQL, esquema, eliminaci?n ni cambios productivos. Subida/descarga id?ntica de factura sint?tica verificada; objeto de comprobaci?n conservado bajo el proveedor de ensayo.

El formulario permite IVA 5%, 10% o exento y distingue importes con/sin IVA. Calcula subtotal, IVA y total; el servidor recalcula los valores. Los importes extra?dos del documento se conservan sin forzar una tasa ?nica (incluye tasas mixtas). Formulario usa onSubmit para conservar campos tras errores, y env?a el File del estado aunque se remonte el input del adjunto. Cambios de IVA/reintento reflejados tambi?n en la copia hist?rica erp-before-live, conservando sus otras diferencias. No equivale a validar que ambos ?rboles sean id?nticos.

Configuraci?n comprobada sin mostrar secretos: OPENAI_API_KEY presente en proyecto original, ausente en erp-recovery y erp-before-live. No se copi? la credencial original; pendiente configurar clave exclusiva de preview. La lectura autom?tica de factura NO verificada. Guardado completo de factura y pagos NO verificados. No declarar ciclo E2E completo.

Validaci?n: typecheck del worktree PASS; lint de archivos modificados del worktree PASS; 24 tests de VAT/aritm?tica/extracci?n PASS; diff check PASS. UI confirm? 100.000 con IVA 10% incluido = subtotal 90.909 + IVA 9.091. Lint de actions.ts hist?rico del runtime mantiene un any preexistente fuera de esta modificaci?n; no se corrigi? c?digo ajeno al pedido. No main/push/deploy.


## Conciliacion por campo - 12/10/2026 23:40 Paraguay

Se reemplazo la aceptacion general de discrepancias en Administracion/PROCUREMENT por resoluciones especificas. Tabla compacta Portal/Documento/Resolucion; solo muestra diferencias y datos no verificables. Verificacion del original por campo, o solicitud de correccion que bloquea continuar. Sin textarea ni confirmaciones adicionales. Incluye IVA incluido/adicional. No modifica Costeo/COST_DISCOVERY ni escribe un parser nuevo.

El servidor vuelve a extraer del adjunto inmutable, ignora transcripciones arbitrarias del cliente en Procurement, exige una decision por diferencia y rechaza snapshots distintos, duplicados, decisiones ajenas o pendientes. Guarda evidencia automatica, hechos verificados y decisiones en los JSON existentes de rfq_quote_reviews; no SQL ni cambio de esquema. Una revision antigua con discrepancias sin la nueva politica no habilita nuevas adjudicaciones. Guardas en save/authorize/preview/confirm recargan la version vigente y sus revisiones. Esto valida las acciones de la aplicacion; no constituye una nueva auditoria completa de permisos o RPC directas de DB.

Ensayo real UI y portal externo, sin precargar hechos extraidos: RFQ-2026-0009 a04892e6-f1b3-4037-9512-186524ef65f1. V1 fd5f1e00-ce36-4b2d-bb80-283f66468dbb: portal 1000 PYG, XLSX 1200 PYG. Se detecto discrepancia y ausencia de evidencia de IVA incluido; elegir correccion dejo deshabilitado Adjudicar y revisar OC, incluso con motivo seleccionado. V2 5933d237-cd07-4760-bdf2-3f47b9aedc79: portal 1200, XLSX 1200 e IVA incluido explicito. Analisis automatico sin diferencias; revision/guardado/autorizacion/preview via UI llegaron a 120.000 PYG. NO se pulso Emitir OC. Ambas versiones y adjuntos permanecen guardados, verificado mediante SELECT aislado. OC-2026-0005 y su flujo de factura no se modificaron por este ensayo.

Validacion: 53 tests focales PASS; typecheck PASS; lint de implementacion PASS; diff check PASS. Capturas: conciliacion-discrepancia-bloqueada.png y conciliacion-version-corregida-preview.png en el directorio padre. El ensayo E2E documental utilizo XLSX. No declara OCR generico de PDF recuperado: si el lector existente no reconoce campos, siguen No verificable y requieren revision especifica contra el original. Clave OpenAI de preview sigue pendiente. No main, produccion, push ni deploy.

## Lectura automatica de factura habilitada - 13/10/2026

El propietario autorizo expresamente reutilizar la clave OpenAI existente en la preview. Se copio solo OPENAI_API_KEY desde el .env.local original a los .env.local ignorados de erp-recovery y erp-before-live, sin imprimir secretos ni modificar el original. Antes de escribir se exigio NEXT_PUBLIC_SUPABASE_URL con hostname exacto kyiihlkncatojvlasoag.supabase.co en ambos destinos. Ninguna credencial Supabase fue copiada. Next recargo .env.local; puerto 3002 permanece activo.

Prueba real UI sobre OC-2026-0005: formulario vacio (excepto proveedor preseleccionado por OC), subir factura-ensayo-integral.pdf, accion extractInvoiceFromPhoto, OpenAI real, autocompletado sin editar campos: numero 001-001-0000001, fecha 2026-10-12, importe 100000, subtotal 90909, IVA 9091, total 100000, IVA Segun documento. Aviso de proveedor no identificado: el PDF sintetico no contiene RUC y la busqueda actual usa RUC; queda seleccionado Proveedor Ensayo Integral por contexto OC. Vencimiento y timbrado ausentes permanecen vacios. No se pulso Crear factura; no se creo factura ni pago en este ensayo. No codigo, SQL, schema, main ni produccion modificados. Capturas padre: factura-autocompletada-openai-preview.png y factura-autocompletada-importes-preview.png. Pesta�a 13 conservada como entregable con el formulario completo para revision del propietario. La prueba acredita este PDF con texto; no certifica todos los escaneos ni cierre del ciclo de pagos.

## Aviso proveedor y footer factura - 13/10/2026

Cambios limitados a invoice-dialog.tsx en recovery y copia historica runtime. Para una factura desde OC sin RUC identificado, se conserva el proveedor seleccionado y el aviso pide verificar el emisor, sin pedir elegir o crear de nuevo. Si hay RUC no identificado, sigue visible el aviso correspondiente; no se afirma coincidencia de identidad sin evidencia. Runtime reemplaza providerRef incompatible con Select Radix por estado controlado, como ya usaba recovery.

Modal propio de factura con titulo y acciones fuera del area desplazable; solo los campos scrollean. No modifica Dialog compartido ni CSS global. Prueba UI real: subir PDF, autocompletado correcto, aviso nuevo visible, Crear factura habilitado y completamente dentro del viewport. Captura padre factura-aviso-footer-corregidos.png. No se pulsa Crear factura; queda para que propietario continue hacia pago. Typecheck y lint componente recovery PASS; diff check PASS. No SQL, cambios DB, main ni produccion. Servidor localhost:3002 sigue activo.

## Carga masiva operativa en preview - 13/10/2026 00:30 Paraguay

Se levanto el worker EXISTENTE de erp-recovery/worker/index.ts, sin cambiar su codigo ni reemplazar el parser. Runtime web sigue erp-before-live:3002. Worker PID 23964, Node en background windowsHide=true, polling 2500 ms. Launcher local fuera del repo: ../preview-invoice-worker.cjs. Lee exclusivamente erp-recovery/.env.local, exige hostname kyiihlkncatojvlasoag.supabase.co antes de importar worker y fuerza SUPABASE_URL igual al NEXT_PUBLIC_SUPABASE_URL verificado. Usa service role aislado y OpenAI existente autorizado. No ejecuto worker historico de erp-before-live porque no contiene las guardas/RPC atomicas actuales. TSX fallo uv_os_get_passwd ENOMEM en este sandbox; launcher transpila los mismos TS mediante TypeScript transpileModule CommonJS en memoria, sin modificar node_modules ni secretos. Primer PID 8888 termino; PID 23964 quedo activo. Logs TEMP/erp-preview-invoice-worker.stdout.log y .stderr.log (stderr conserva fallo anterior de TSX). Para reiniciar tras apagar PC: node ../preview-invoice-worker.cjs desde erp-recovery; verificar destino/logs antes de crear otro proceso, no correr dos por accidente.

Antes de comenzar se confirmo invoice_jobs vacia y RPC claim_invoice_job/create_invoice_from_job existentes mediante SELECT aislado. Se agrego via UI el RUC FICTICIO 99900001-0 al Proveedor Ensayo Integral para que la identificacion real por RUC sea comprobable. Se generaron 3 PDF sinteticos con texto, no validos fiscalmente, en directorio padre: bulk-qa-valida-0091.pdf, bulk-qa-duplicada-0091.pdf, bulk-qa-proveedor-desconocido-0092.pdf. Enviados juntos por UI real /invoices/bulk, sin precargar extracted ni jobs via SQL.

Resultados UI y readback SELECT: job38bef03c-2e3f-4289-ab74-63f1881f6948 done/matched en primer intento: factura001-001-0000091 id2b4ac572-9b46-4b87-9bb9-a69d07cfbbf5 total100000 PYG, una linea, vinculada OC-2026-0005 c4268f21-2fc5-4e8f-9ea1-af28fbc289ae segun referencia del PDF. Jobee2984b4-51d4-4a24-8f64-a3d28cdad3b6 needs_review/duplicate, invoice_id null; count facturas numero0091/proveedor=1. Jobf271e840-ca63-4fa3-a295-59950203b518 needs_review/needs_manual: RUC99999998-0 proveedor no registrado, hechos extraidos preservados, sin crear factura. Captura bulk-lote-real-resultados.png y bulk-proveedor-ruc-sintetico.png. Pesta�a16 conserva resultados.

No marcado apto, OP ni pago ejecutados. Factura anterior001-001-0000001 id0621f55e-ab25-4635-a3cd-4b0c82c25a60 permanece vinculada OC-2026-0006; no se reasocio. No SQL correctivo/destructivo, migracion, prod, main o despliegue. Prueba acredita PDFs con texto y estos tres casos; no todos los escaneos o formatos. Worker quedo activo mientras se prueba preview.
