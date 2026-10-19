# Correcciones D1 a D6 y Fase 4 del PR 38

Entrega para la revisión de Claude sobre la rama `codex/compras-ventas-merge-prep`. Base de la revisión: `47122ce`. Último commit de código: `7c5ce2a`. Los cambios están comprometidos localmente; no se hizo push, deploy ni merge. La única base consultada fue `kyiihlkncatojvlasoag`. Producción y Nexora quedaron fuera de esta tarea.

## Hallazgos y commits

| ID | Estado | Commit | Resultado |
| --- | --- | --- | --- |
| D1 | Corregido | `3a59972` | Solo JPEG, PNG, WEBP, HEIC y PDF. GIF y planillas se rechazan antes de crear registros. UI y mensajes alineados; no se amplió Storage. El cierre de #32 completa dos textos residuales y las regresiones del POST. |
| D2 | Corregido | `1fd90d9` | Proxy de Next configurado con `proxyClientMaxBodySize: "21mb"`, que es el nombre vigente en la versión instalada. Margen multipart para un archivo de 20 MiB. Errores de tamaño y parseo con mensaje claro. |
| D3 | Corregido | `c5d6455` | Se eligió la alternativa solicitada de mostrar cada archivo pendiente y su motivo. No se borran pendientes anteriores automáticamente ni se anuncia un engañoso “parcial 2/2”. |
| D4 | Corregido | `baaf136` | El pendiente de OC cuenta solo recepciones CONFIRMED. Los DRAFT permanecen disponibles para reintentar con la misma clave, sin descontar el pendiente. |
| D5 | Corregido | `6693234` | Rendición cerrada durante el envío responde 409; conflicto de stock inicial en español y carácter roto corregido. |
| D6 | Corregido | `492f4cb` | Se limpia la identidad del intento de consumo solo ante 4xx; se conserva ante 5xx y pérdida de conexión. |
| #30 | Corregido | `491c62f` | Texto “2.5” conserva 2.5. “1.234” y “1,234” quedan bloqueados por ambiguos. Se preservan números nativos de Excel. |
| #29 | Corregido | `2742650` | Detección de columnas por etiquetas completas; la variante “n” ya no captura Descripción, Unidad o Cantidad. |
| #31 | Corregido | `f7843f4` | Pegado de avance bloquea números ambiguos, códigos desconocidos/repetidos y recuentos incompatibles. |
| #28 | Corregido | `a4f897c` | No se monta el detalle de un certificado eliminado. #32 completa el estrechamiento de tipos para indexar sus anexos con el id existente. |
| #33 | Corregido | `f4e305b` | Vaciar cantidad o deducción no guarda cero. Cero explícito sigue permitido. Errores al guardar avance por unidad se muestran y no simulan un guardado exitoso. |
| #34 | Corregido | `b5deec8` | Confirmación antes de eliminar una versión del cronograma o descartar una sesión de importación. Si el descarte falla, se conserva la sesión y se muestra el error. |
| #32 | Corregido | `7c5ce2a` | Presupuesto, cronograma y receta bloquean filas inválidas o incompletas; APU bloquea filas sin resolver y pide aceptación expresa de diferencias de totales/observaciones. Certificados exigen aceptación explícita de filas autónomas y discrepancias. |

No se clasificó ningún hallazgo de esta entrega como falso positivo.

## Controles de importación

Presupuesto valida todas las filas antes de insertar, incluidos códigos duplicados, números y fechas. El preview puede mapear “Importe de fila” y compara ese importe con cantidad por precio. No importa solo las filas válidas cuando el archivo contiene errores.

Cronograma valida vínculos, fechas, predecesoras y duplicados antes de actualizar. Un vínculo por similitud exige confirmación expresa. El servidor también valida todo el lote antes de la primera escritura.

APU valida todos los insumos antes de crear productos o plantillas, incluidos materiales ambiguos, unidades y jornales. Solo después de esa validación crea los productos previstos y sustituye sus identificadores temporales por los ids reales. Las discrepancias del preview se muestran al pedir la confirmación. Las escrituras por tablas siguen siendo varias operaciones: una falla de infraestructura después de iniciar la persistencia puede dejar resultados parciales, que deben revisarse antes de reintentar. Esta entrega no añade una transacción SQL global para esos importadores.

Receta conserva las filas no vacías con datos inválidos para corregirlas; una selección manual no evita validar la cantidad. La carga manual no descarta filas incompletas. Su parser tampoco convierte “2.5” en 25.

Certificados ya exigían aceptación de diferencias numéricas. Se añadió el caso de filas sin vínculo con el presupuesto, tanto en UI como en el servidor. Se preservan como líneas autónomas solo con aceptación expresa.

## Pruebas

Los tests nuevos ejecutan parsers, manejadores de eventos y acciones del código real. Para funciones privadas de componentes, el soporte de prueba extrae sus declaraciones TypeScript/TSX y las ejecuta con dependencias controladas; no copia el algoritmo ni falla por falta de un módulo nuevo.

Las regresiones fallaron primero por el comportamiento observado: GIF aceptado, HTTP 500 con 12 MiB a través del build anterior, archivo pendiente sin identificar, DRAFT contado como recibido, conflicto con 500/inglés, identidad de consumo eliminada tras 503, errores de números/columnas, detalle huérfano, vacío guardado como cero, borrado sin confirmación e importación parcial silenciosa. Después pasaron con los cambios.

Se reforzaron #13 y #14 invocando los eventos del componente real, #15 invocando el POST real y simulando una confirmación entre lectura y actualización, y #17 invocando el contexto real con dos filas de stock. Estos dobles controlados prueban el comportamiento; no certifican concurrencia entre sesiones PostgreSQL. La concurrencia de #19 quedó cerrada por la revisión recibida de Claude y no se modificó aquí.

| Comprobación | Resultado |
| --- | --- |
| Regresiones específicas finales | 33/33 en 7 archivos |
| TypeScript `--noEmit` | Aprobado |
| Vitest completo sin paralelismo por archivo | 2374 aprobados, 16 omitidos; 242 archivos aprobados y 2 omitidos |
| `npm run build -- --webpack` | Aprobado, incluida su comprobación TypeScript; ejecutado después de terminar Vitest |
| HTTP multipart de 12 y 19 MiB sobre build final | Ambos llegan a la validación normal y responden 400 “Faltan datos”; ninguno devuelve 500 |

La prueba HTTP de tamaño usa el proxy real y una recepción sin datos obligatorios: espera 400 “Faltan datos”, demostrando que el cuerpo grande llega intacto al manejador. No se presenta como una recepción completa con subida a Storage.

Comandos de verificación: `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run --no-file-parallelism --maxWorkers=1` y `npm.cmd run build -- --webpack`. La regresión HTTP se ejecutó con `next start -p 3018` y `node scripts/qa/warehouse-large-body.cjs`, verificando el host aislado antes de cada operación. Se eliminó su enlace temporal y se detuvo el servidor de prueba al terminar. Las 33 regresiones específicas incluyen los casos añadidos mientras corría la batería completa; se ejecutaron también por separado sobre el código final.

## Ledger y permisos de la base aislada

No fue necesaria una migración nueva para D1 a D6 o Fase 4. Una consulta SELECT sobre `kyiihlkncatojvlasoag` confirmó:

- Las diez versiones `20261018120000` a `20261018120900` están aplicadas.
- Cinco triggers activos: anulación de proforma, precio de otra empresa, responsable de OT, tope de emisión y stock inicial.
- Las funciones privadas no permiten EXECUTE a anon, authenticated ni service_role.
- `inventory_portal_receipt`: anon=false, authenticated=false, service_role=true.
- `ejecutar_orden_pago_atomica` y `mark_apto_y_crear_op_atomica`: anon=false, authenticated=true, service_role=true.
- Funciones revisadas con `search_path=""`.
- `warehouse_portal_links.expires_at` sigue NOT NULL.
- La restricción de cuenta en pago ejecutado continúa NOT VALID: no sanea pagos históricos sin cuenta.

Consulta reutilizable: `scripts/qa/verify-pr38-migrations.sql`. Solo lee ledger y catálogos. Puede ejecutarse con un login de lectura que ya tenga SELECT sobre `supabase_migrations.schema_migrations`; una clave REST anon/service_role no permite leer automáticamente ese esquema. No se agregaron permisos ni endpoints para exponerlo.

Con la CLI autenticada y el ref explícito:

```powershell
$auditRef = 'kyiihlkncatojvlasoag'
if ($auditRef -cne 'kyiihlkncatojvlasoag') { throw 'Destino incorrecto' }
supabase.cmd db query --linked --project-ref $auditRef --file scripts/qa/verify-pr38-migrations.sql
```

Para una conexión PostgreSQL de solo lectura, se puede ejecutar el mismo archivo con psql después de verificar que la conexión pertenece a esa branch. No se incluyen credenciales en el repositorio ni en este informe.

## Revisión final de Claude

Revisar los commits indicados, repetir los recorridos del portal —incluidos GIF, 12 MiB, reemplazo de adjunto fallido, borrador de recepción y reintentos 5xx— y probar los cinco importadores con una fila inválida junto a una válida. Comprobar cancelación y aceptación de confirmaciones, borrado del certificado abierto y campos vacíos.

La migración anterior #12 vence inmediatamente enlaces de depósito sin vencimiento; los QR impresos afectados requieren emitir un enlace nuevo. Para un rollout autorizado, verificar también los cinco MIME types y el límite de Storage descritos en `pr38-D1-storage-rollout.md`. No se consultó producción para esa comprobación.

Esta entrega termina D1 a D6 y Fase 4. No concede GO de integración ni cierra Fases 5, 6 y 7. El E2E de navegador y el GO/NO-GO final corresponden a la revisión de Claude sobre el SHA entregado.
