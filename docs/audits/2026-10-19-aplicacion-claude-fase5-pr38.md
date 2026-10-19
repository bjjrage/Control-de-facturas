# Aplicación de correcciones de Claude y Fase 5 del PR 38

Trabajo realizado sobre `codex/compras-ventas-merge-prep`, a partir de `da466da`. Último commit de código: `0507d64`; `043c840` actualiza dos fixtures de regresión. Los commits son locales: no se hizo push, deploy ni merge. Solo se operó la branch Supabase `kyiihlkncatojvlasoag`, fijando el ref antes de cada operación.

## Parches recibidos

Se importó `refs/claude/pr38-fixes` desde el repositorio local indicado y se aplicaron los tres commits en orden, sin conflictos y conservando el trailer `Co-Authored-By: Claude Sonnet 5.5`.

| Original de Claude | Commit aplicado | Cambio |
| --- | --- | --- |
| `7fff9ce` | `bb074b7` | D6: error ambiguo de RPC conserva el intento mediante HTTP 503 |
| `9cae53f` | `44de3db` | #29/#32: lectura UTF-8 y motivo visible de las filas bloqueadas |
| `4a9c0bb` | `8dfe27e` | #34: activar otra versión antes de borrar la anterior; con una sola no se ofrece borrar |

Las pruebas específicas de esos cambios y confirmaciones existentes pasaron: 15/15 en la primera verificación. La revisión añadió los controles siguientes.

## Revisión del tratamiento de errores RPC

Los códigos de negocio usados en las migraciones revisadas, incluidos `P0001`, `P0409`, `23505`, `23514`, `22023`, `42501` y `55000`, permanecen como rechazos definitivos. No se encontraron códigos de negocio declarados en las clases 53 o 57 del SQL versionado; esas clases se conservan como ambiguas.

Se encontró una excepción adicional: `40003` representa una finalización desconocida de sentencia según el [catálogo oficial de PostgreSQL](https://www.postgresql.org/docs/current/errcodes-appendix.html). También debe preservar la identidad del intento. Se corrigió en `c196b62`.

En el portal de recepción anterior se encontró un riesgo equivalente: cualquier error de `submit_receipt_portal` producía 409 y eliminaba los originales recién subidos, aunque la transacción pudiera haberlos referenciado. Ahora una respuesta incierta produce 503 y conserva los originales para comprobar la recepción; un rechazo de negocio sí permite retirar su subida no utilizada. La prueba del POST real reproduce la diferencia.

También se revisaron las rutas que llaman RPC indirectamente. La confirmación de planillas convertía errores inciertos en 400 y una respuesta sin datos en un éxito con cero cambios. `422e6cd` agrega un error tipado con respuesta 503 y conserva la sesión. Se mantienen 404 para ausencia, 409 para concurrencia y el tratamiento de rechazos definitivos. Las rutas Gmail revisadas usan redirecciones de resultado, sin el patrón de 400 analizado.

## Fase 5

| Hallazgo | Estado | Commit | Resultado |
| --- | --- | --- | --- |
| #9 | Corregido | `ac768dd` | Un error al activar/desactivar una cuenta se muestra y no refresca como si hubiera tenido éxito |
| #21 | Corregido | `81d1ecd` | El error de reversa de cobro llega al aviso existente de la página |
| #35 | Corregido | `e689f41` | Errores de listar/borrar APU y pagos de mano de obra visibles aun con el diálogo cerrado |
| #39 | Corregido | `4caeb61` | DNCP verifica los guardados y las eliminaciones previas; una falla devuelve importación incompleta. Las ofertas solo se cuentan como guardadas después de persistirlas |
| #36 | Corregido | `0aad30c` | Coordenadas vacías o fuera de rango se bloquean antes de pedir forecast. No se inventa Asunción ni se confunde una coordenada cero válida con ausencia |
| #27 | Corregido | `edf18f4` | Cron con fecha de Paraguay; fechas futuras e inválidas rechazadas antes de evaluar |
| #26 | Corregido | `2e76aaf` | La actualización meteorológica externa no escribe el estado de un evento existente y no puede devolver a PROPOSED una confirmación concurrente |
| #22 | Corregido | `c30d51d` | Estado de cuenta impreso identifica los cobros revertidos con fecha y motivo, conservando el registro |
| #25 | Corregido | `7414931` | La acción de RFQ de costeo serializa pedidos equivalentes y reutiliza el pedido abierto |
| #8 | Corregido | `565862b` | La revisión manual verifica el archivo original mediante el control canónico de RUC, moneda, número, fecha y total antes de intentar el vínculo con una OC |

No se clasificaron falsos positivos. En #26, el evaluador ya conservaba la clasificación de jornadas existentes; quedaba una carrera al actualizar el estado del evento climático desde una lectura anterior. Las correcciones humanas explícitas conservan su flujo auditado.

En #8, si la verificación del original falla, la factura creada permanece referenciada y el job queda en revisión, sin vincular ni conciliar. No se recrea la factura para resolver esa situación. Una prueba anterior esperaba terminar el job sin original verificable; se actualizó para exigir revisión y mantener las comprobaciones de creación atómica y lease exacto.

En #39 se informa el punto de fallo y el resultado incompleto; no se agregó una transacción global para todas las tablas DNCP. Un fallo después de guardar la cabecera puede dejar datos parciales visibles para revisión y reintento. No se afirma rollback global.

## Formato Paraguay elegido por el usuario

`d668fe4` agrega un selector explícito en presupuesto, receta y pegado de avance:

- Modo estricto por defecto: “350.000” y “1.234” como texto siguen bloqueados.
- Modo Paraguay: punto de miles y coma decimal. “350.000” vale 350000 y “1.234,56” vale 1234.56.
- En modo Paraguay, “2.5” como texto se bloquea; debe escribirse “2,5”. Un número nativo 2.5 de XLSX conserva 2.5.
- El cambio de selector recalcula el preview; en receta se conserva el valor fuente para poder reinterpretarlo.
- CSV mantiene los valores textuales y códigos con ceros iniciales hasta esa elección, tanto UTF-8 como Windows-1252. El último caso se completó en `0507d64`.

Las pruebas reprodujeron el bloqueo sin selector y la conversión prematura del CSV Windows-1252; después pasaron. También se probó cambiar el selector del componente de presupuesto sobre las mismas filas sin volver a leer el archivo.

## Migración y prueba concurrente real de RFQ

Migración nueva: `20261019165649_cost_rfq_retry_idempotency.sql`. Se aplicó junto con su registro en el ledger, en una sola transacción y únicamente en `kyiihlkncatojvlasoag`.

El RPC `rfq_create_cost_once` valida actor, plan y proyecto. Calcula la identidad del pedido con proyecto, rubro, ítems normalizados y proveedores; excluye la nueva fecha de vencimiento del reintento. Un bloqueo asesor por empresa e identidad serializa esta acción. Se reutilizan pedidos abiertos y no vencidos; los pedidos diferentes conservan una identidad distinta. El guardado continúa por el RPC canónico de RFQ. No se borraron ni deduplicaron pedidos anteriores.

Comprobación final por lectura:

- Ledger: 11/11 versiones esperadas aplicadas.
- Cinco triggers financieros/inventario anteriores activos.
- RPC nuevo con SECURITY INVOKER y `search_path=""`.
- EXECUTE: authenticated=true; anon=false; service_role=false.
- MD5 de definición del RPC nuevo: `1303f6973ccb01a8a1b0f5b4a02f7940`.
- Consulta reutilizable actualizada: `scripts/qa/verify-pr38-migrations.sql`.

La concurrencia se probó en dos sesiones PostgreSQL reales, con `SET LOCAL ROLE authenticated` y el actor QA existente. Ambas devolvieron `099268d7-a9fe-469d-b028-f63f5de74da7`: una con reused=false y otra con reused=true. Lectura posterior: una sola `RFQ-2026-0034`, BORRADOR y cero proveedores. No hubo invitaciones ni mensajes. Se conserva este borrador QA para la revisión.

El archivo reproducible es `scripts/qa/cost-rfq-concurrency-isolated.sql`; está preparado para el actor y tenant sintéticos de esta branch y debe ejecutarse siempre con el ref aislado explícito. La prueba PGlite comprueba reintento, cambio de contenido, rechazo de un proyecto ajeno y permisos; no se usa como evidencia de concurrencia.

## Verificación final

Cada defecto nuevo tuvo una regresión que falló por el comportamiento antes del arreglo y pasó después. Las pruebas usan manejadores, acciones o consultas reales con dependencias controladas; el caso concurrente de #25 usa dos sesiones de la base aislada.

| Control | Resultado |
| --- | --- |
| TypeScript `--noEmit` | Aprobado sobre el código final |
| Vitest completo, secuencial, timeouts de 60 s | 2427 aprobadas, 16 omitidas, 0 fallas; 259 archivos aprobados y 2 omitidos |
| Build `--webpack` después de terminar PGlite | Aprobado, salida 0; compilación, tipos, 59 páginas estáticas y trazas finalizadas |
| Ledger, permisos y prueba concurrente #25 en aislada | Aprobados |

La corrida inicial detectó la expectativa obsoleta del job manual. Tras corregirla, sus 72 regresiones específicas pasaron y la suite completa volvió a ejecutarse: terminó sin fallas en 256,56 segundos. No se presenta esa primera corrida con fallo como una suite aprobada.

Comandos de verificación local:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --no-file-parallelism --maxWorkers=1 --testTimeout=60000 --hookTimeout=60000
npm run build -- --webpack
```

El build se inició después de terminar Vitest/PGlite. Las 16 pruebas omitidas no se cuentan como verificadas; esta suite tampoco sustituye el E2E en navegador.

Los asesores de seguridad de la branch aislada señalaron dos vistas SECURITY DEFINER preexistentes: `v_procurement_competitor_contextual` y `v_procurement_competitor_global`. Ambas ya aparecen en la baseline de octubre 2 y agregan tablas globales de procurement. No se cambiaron sus permisos; la alerta de configuración queda documentada para revisar en Fase 6, sin afirmar una fuga de datos demostrada.

## Pendientes de E2E y antes de merge

Esta entrega deja la Fase 5 corregida para revisión; no constituye GO de merge. Claude debe repetir el E2E sobre el SHA final, en particular:

1. Resolución manual con original válido y RUC distinto; preservación de factura/job al fallar la verificación.
2. Visibilidad de errores, cobros revertidos, coordenadas vacías/cero, cron en el límite de fecha local y conservación de confirmaciones.
3. Reintento de RFQ y elección explícita de formato Paraguay, incluidos CSV de ambas codificaciones.
4. Los puntos que su informe dejó sin probar: APU y certificado #32, error de avance por unidad #33 y descarte de sesión #34.

Continúan pendientes de Fase 6 C06/PDF escaneado, U1/179 pantallas y la revisión de las alertas de vistas. La verificación del bucket de producción y la renovación de QR impresos no se ejecutaron: producción sigue fuera del alcance autorizado. La restricción #4 continúa NOT VALID y conserva los pagos históricos sin cuenta. Los archivos y cambios previos sin seguimiento se preservaron.
