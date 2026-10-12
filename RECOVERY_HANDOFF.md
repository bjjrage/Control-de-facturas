# Handoff de recovery — PARCIAL

El trabajo queda local en `recovery/compras-ventas-approved`. No push, PR, merge, deploy, cambios de infraestructura ni operaciones productivas. La auditoría SENTINEL y su SHA congelado no fueron retomados ni certificados.

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
