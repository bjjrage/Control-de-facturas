# Batch 1A-Lite — Informe de implementación

## Alcance y control Git

- Base solicitada: `5b1e1d638a6fc517dd464c3bec6643dbb03634cc`.
- `origin/main` y el `main` local coincidían con esa base al iniciar el batch.
- Rama: `batch/01a-lite-tesoreria`.
- Worktree: `.worktrees/batch-01a-lite-tesoreria`.
- Tag de checkpoint: `checkpoint-pre-batch-01a-lite`, apuntando a la base solicitada.
- Commit funcional de Tesorería: `a90d104ea8b8c844e6c240659975bf4fd4a74442`.
- Commit funcional de certificados: `63f01e708e970f0ef5436affcba9c938799eb781`.
- Los commits funcionales son consecutivos sobre la base indicada. Este informe se guarda en un commit documental separado.

### Nota sobre el ledger

`GIT-FREEZE-POLICY.md` y `GIT-LEDGER.md` todavía identifican `1a71c96279febf6636892143af20f36a0315f5ae` como baseline. Para este batch se usó `5b1e1d638a6fc517dd464c3bec6643dbb03634cc`, que era el SHA exigido por la instrucción del batch y coincidía con `origin/main` y el `main` local. La discrepancia documental queda registrada para conciliación posterior.

## Cambios

### Tesorería

En `app/(internal)/tesoreria/actions.ts`, los importes no finitos y cero se rechazan. Se aceptan ajustes manuales con signo positivo o negativo; ingresos y egresos exigen importe de entrada positivo. El egreso continúa enviándose al RPC con signo negativo. No se cambió la interfaz ni el contrato del RPC.

Pruebas añadidas en `lib/tesoreria/__tests__/manual-adjustment.spec.ts` para los signos permitidos, rechazos de cero/negativos y valores no finitos, además del contrato de argumentos del RPC.

### Certificados

En `app/(internal)/projects/certificado-workbook-actions.ts`, antes de la primera eliminación se validan las filas generadas: descripción no vacía y valores de `qty_contractual`, `qty_anterior`, `qty_presente` y precio unitario presentes, finitos y no negativos. Los errores identifican fila de origen y código. Si hay errores, la acción retorna antes de borrar, insertar o actualizar encabezados.

Pruebas añadidas en `lib/certificates/__tests__/workbook-pre-delete-guard.spec.ts`; verifican las entradas inválidas, los mensajes de fila/código y la ausencia de llamadas de escritura.

**ATOMICITY IMPLEMENTED: NO**

**CAS IMPLEMENTED: NO**

## Verificación de producción, solo lectura

Proyecto consultado: `ezucivipgmbvamhugkbj`. Las consultas fueron de lectura y verificaron existencia/configuración de objetos; no se ejecutó ninguna escritura.

- `public.prevent_treasury_ledger_mutation`: presente.
- `public.crear_cuenta_financiera_atomica`: presente.
- Trigger `trg_treasury_ledger_append_only`: presente y habilitado (`O`) en `public.movimientos_tesoreria`, enlazado a `public.prevent_treasury_ledger_mutation`.
- `public.revertir_cobro_atomico`: presente.
- `public.select_and_authorize_offer_atomically`: presente.

**PRODUCTION WRITES: NONE**

**MIGRATIONS MODIFIED: NO**

**SUPABASE MODIFIED: NO**

## Pruebas y build

- Pruebas enfocadas: `npx.cmd vitest run lib/tesoreria/__tests__/manual-adjustment.spec.ts lib/certificates/__tests__/workbook-pre-delete-guard.spec.ts` — PASS, 2 archivos y 21 pruebas.
- TypeScript: `npx.cmd tsc --noEmit` — PASS.
- Suite completa en ejecución serial: `npx.cmd vitest run --maxWorkers=1` — PASS, 143 archivos aprobados, 2 omitidos; 1.275 pruebas aprobadas y 16 omitidas.
- Ejecuciones paralelas de Vitest: hubo timeouts en pruebas basadas en PGlite por contención; la suite serial completa pasó. Una ejecución paralela reportó 142 aprobadas y 2 omitidas antes del timeout; otra, 138 aprobadas y 2 omitidas con cinco timeouts de hooks/pruebas PGlite.
- Build: `npx.cmd next build --webpack` — PASS con variables públicas de Supabase locales ficticias, configuradas solo para ese proceso (`http://127.0.0.1:54321` y `local-build-placeholder`); compiló y prerenderizó las 58 páginas estáticas. No se usaron credenciales de producción.
- El build predeterminado con Turbopack no resolvió dependencias desde este worktree aislado. El build con Webpack sin variables públicas llegó a prerenderizar y falló en `/reset-password` por faltar la URL y la clave pública de Supabase; con placeholders locales, el build Webpack terminó correctamente.

## Resultado

El diff funcional se limita a los dos archivos de acción y sus dos pruebas. No hay migraciones ni cambios de esquema. No se hizo push, merge ni escritura en producción. La rama queda lista para auditoría.
