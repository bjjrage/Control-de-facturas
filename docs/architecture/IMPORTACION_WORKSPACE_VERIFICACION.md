# Importación directa al workspace

El archivo se guarda en una sesión y abre `/projects/import/[id]`, una página de trabajo recuperable desde **Obras → Planillas en preparación**. La obra se crea sólo al confirmar la revisión guardada. Esta entrega conecta la entrada de Excel con las vistas nativas del primer lote.

## Comportamiento

- Partidas: grilla Univer, fórmulas propias, pegado, cantidades y precios adoptados. Identidad, descripción y unidad del archivo se conservan durante la vinculación; el workspace operativo permite su edición tras crear la obra.
- APU: receta por partida, consumos, precios y celdas de procedencia. Tras crear la obra, **Editar APU** permite guardar consumos, mermas, horas y tarifas de los componentes vinculados. Conserva sus identidades y los precios de origen del material; las categorías laborales conservan su tarifa vigente.
- Materiales: necesidades por consumo de cada APU y cómputo del borrador; navegación a las partidas que las originan. Tras crear la obra se consultan las relaciones y mermas vigentes del ERP.
- Cronograma: vínculos demostrados por fórmulas hacia las partidas fuente y encabezados de cada sección. Los códigos de equipos no se vinculan por mera igualdad numérica. La curva general se deriva de la distribución monetaria completa reconciliada con cada partida, conservando los valores del documento.
- Original: copia de la fuente en consulta; archivo inmutable conservado en Storage. El borrador operativo vive en `workspace_draft`, separado de las celdas fuente.
- Guardado por empresa, rol y revisión esperada. La creación reextrae y valida en servidor, aplica el borrador guardado y usa la transacción existente con bloqueo de revisión e idempotencia. Las fórmulas nuevas revisadas se conservan al abrir el primer borrador operativo.

Las cantidades referenciales siguen identificadas. En la obra creada, el cómputo y los APU vigentes actualizan la proyección mensual de venta, costo directo y materiales usando la distribución verificada de cada partida. Se conservan los días y los importes del documento como línea base. Este cambio no certifica recálculo universal de Excel ni compatibilidad con cualquier formato de APU.

## Verificación

`node scripts/qa/verify-import-workspace.mjs <origen-QA>` exige la base QA y un origen permitido. Crea una empresa de prueba aislada y usa el archivo real de Lote 2; no modifica datos empresariales de producción. Las evidencias privadas quedan en `audit-artifacts/workbook-linked-import/import-workspace-qa-*`, fuera de Git.

La prueba recorre carga desde navegador, análisis real de Luna, recuperación desde Obras, edición de fórmula, guardado/reapertura, rechazo de revisión atrasada, necesidades de un material afectado por la edición, las cuatro vistas antes/después de crear, relaciones operativas y archivo byte a byte idéntico. Verifica aislamiento entre empresas y rechazo anónimo.

Resultado local y desplegado en QA: 597 partidas, 597 APU, 597 plazos relativos, 2.199 relaciones de materiales, 1.200 de mano de obra, 896 de equipos, 346 de transporte y una curva general. El circuito completo pasó en la revisión final antes de publicar en IASA el 30 de octubre de 2026.

## Evidencia de la revisión final

- Código de aplicación: `ec74cf39f5f885f3929b7feec4a967398301d410`.
- QA: `dpl_9zhJVSGuFFGHRY6FHCPri1f1R9Nt`, mismo SHA, `READY`.
- Circuito desplegado aprobado: sesión `dadaf7ed-8df1-4c87-aa92-65ef4f82ad8d`, obra QA `dbbec240-1b1c-46ca-8a7a-e8ddc22f0afe`, empresa QA aislada `5ebd3502-bf4e-49f1-b11c-4f59b736eb96`.
- Cantidad editada mediante `=3*2`, expresión y resultado conservados al reabrir; se comprobó la necesidad de un material afectado por esa edición.
- Las cuatro vistas funcionaron antes y después de crear. Se comprobaron los conteos operativos completos indicados arriba, bloqueo de una revisión atrasada, cierre de la importación y acceso denegado desde otra empresa y sin autenticación.
- El visor Original recibió la copia comprimida; muestra valores guardados sin recalcular. La descarga desde la interfaz produjo el mismo SHA-256 del Excel fuente: `6c481dd5f9aa1ce1b3df565ea6b6f2b996f4d26d5dddcf670e946098e3d0a33e`.
- La repetición de Luna clasificó el detalle del cronograma como `OTHER`, separándolo de las series generales. Ese caso se conserva como evidencia: los vínculos comprobados por fórmula funcionan también en anexos de apoyo. Las regiones solapadas no duplican el mismo vínculo; las hojas de otra obra siguen excluidas.
- Cero errores JavaScript de página en el circuito desplegado. TypeScript y el build desplegado pasaron. El lint de los componentes modificados pasó.
- Migración aditiva: QA `20261030042007`, producción `20261030050634`. El archivo del repositorio usa la versión efectiva de producción para evitar una reaplicación futura.
- La interpretación ya guardada de la empresa Iasa se reextrajo en lectura: sesión `a1f6d97f-ba60-4806-aabe-50ea771a107d`, mismo archivo y huella, revisión 1; 597 partidas, 597 APU y 597 plazos, sin observaciones del adaptador. No se creó una obra ni se aplicaron datos de negocio en producción para esta comprobación.
- Pasaron 96 pruebas de regresión seleccionadas; tres casos conservaron sus condiciones de omisión. No se declara probado todo el repositorio.

## Publicación en IASA

- [IASA](https://control-de-facturas-iasa.vercel.app/projects): `dpl_GRpaVCeTsLmZ9JxBvdPwy2YnkB4z`, `READY`, SHA `ec74cf39f5f885f3929b7feec4a967398301d410`, idéntico al código aprobado en QA.
- La migración se verificó con `workspace_draft` no nulo, RLS activo y acceso autenticado. Añade el borrador separado; no carga obras ni modifica las celdas originales.
- Smoke del dominio publicado: cuenta de **niu.pack**, sesión `60859b21-e7ff-4da8-a3b9-21b1926cb5c0`, cuatro vistas, 597 partidas/APU/plazos, cero errores JavaScript y cero escrituras operativas. Esa cuenta recibió 404 al consultar la sesión de la empresa **Iasa**. El análisis de la fuente Iasa en lectura se documenta por separado arriba; no equivale a una creación de obra con la sesión de un usuario Iasa en producción.
- La URL única del despliegue devolvió 403 al acceso directo; la comprobación de producción se ejecutó sobre el dominio IASA publicado. No se modificó la protección de acceso para realizarla.
- Se usó la excepción de build ya autorizada `commandForIgnoringBuildStep: "exit 1"` para esta publicación. Se restauró la regla manual original y se mantuvo desactivada la asignación automática de dominios.
- Bay continúa en `dpl_HUAYx9WHRSfpdwAkYHMM387YsTnh`, SHA `c359fcccc1bf7e78190c607e76207917fe44edef`.
- Rollback de aplicación: reasignar únicamente el dominio IASA al despliegue anterior `dpl_HRRy9FqBXMVhkR2ek3fhkzHTFGQh`. La columna aditiva del borrador es compatible con esa versión.

Acceso para archivos ya subidos: **Obras → Planillas en preparación → nombre del archivo**. No hace falta repetir la carga para las sesiones analizadas de la empresa autenticada. Una carga nueva abre directamente el workspace; la obra operativa se crea al confirmar la revisión guardada.

La comprobación anterior de producción se ejecutó con una cuenta de niu.pack sobre el dominio IASA. No prueba datos de la empresa Iasa; el informe del primer lote se corrigió para explicitar esta diferencia.

## Verificación posterior con la empresa Iasa — 30 de octubre de 2026

Esta comprobación utiliza una sesión autenticada de la empresa **Iasa** (`c040ee03-2302-49d2-8082-b2a4ae5b62af`), con su administradora. Amplía la evidencia histórica anterior con creación y edición real de datos de negocio.

- Se retomó la sesión ya cargada `a1f6d97f-ba60-4806-aabe-50ea771a107d`, sin volver a subir el archivo, y se creó la obra `91e6805f-eda9-4b39-90e5-9c514cc6c896`, código `492833`, Lote 2 (Central), Grupo 1.
- Se comprobaron 597 partidas, 2.199 relaciones de materiales, 1.200 de mano de obra, 896 de equipos, 346 de servicios y un plan de cronograma, dentro de esa empresa.
- La prueba detectó que el diálogo anterior de APU sólo permitía importar o borrar recursos. Se añadió la edición nativa de los componentes existentes con las acciones autenticadas del ERP.
- También detectó borradores duplicados por aperturas simultáneas. La función `planilla_crear_o_retomar` usa un bloqueo transaccional por empresa, usuario, módulo y contexto. Conserva el historial; los borradores antiguos sin modificaciones posteriores a una confirmación ya no desplazan la revisión vigente.
- Un caso de restauración detectó que escribir un número sobre una fórmula mediante la barra de celda dejaba la fórmula anterior en Univer. Ahora reemplaza explícitamente valor, fórmula y texto enriquecido. La regresión comprueba ausencia de fórmula, resultado persistente tras recargar y aplicación al presupuesto. El mismo reemplazo se aplica al pegado de rangos.
- El panel contextual APU se consulta al volver a Partidas para evitar mostrar una receta anterior a la edición realizada en la vista APU.
- Migración efectiva de producción: `20261030112130_planilla_resume_atomic.sql`. Función `SECURITY INVOKER`, ejecución anónima revocada, validación de empresa y rol y RLS existentes; no elimina borradores ni datos históricos.
- Código final: `ebeb8e99f297dd846586b297292644712a58b85b`. QA desplegado: `dpl_2bZnHXwMxPUqwxhpns3ZPLYAiYTw`, `READY`.
- `node scripts/qa/verify-workspace-apu.mjs <origen-QA>` pasó localmente y en QA desplegado: cantidad `1 → 2 → 1`, consumo de material `1 → 1.125 → 1`, necesidad recalculada `2.25`, precio de origen conservado, guardado/reapertura, confirmación operativa y aperturas simultáneas con el mismo borrador vigente. Cero errores JavaScript. TypeScript y lint de los archivos modificados pasaron.
- Publicación final de IASA: `dpl_ABAq8sSvXHraYVmY7WAakEoSA6H7`, `READY`, mismo SHA que QA. Sólo se reasignó el dominio IASA. Se restauró la regla manual original de build y se mantuvo desactivada la asignación automática de dominios; Bay conserva su despliegue y SHA anteriores.
- El circuito anterior se repitió con éxito en **la empresa Iasa de producción**: partida `4 · CARTEL DE OBRA`, cantidad `1 → 2 → 1`, consumo del material Cartel de obra `1 → 1.125 → 1`, necesidad calculada `2.25` y precio documental `1818181.8181818181` conservado. Se confirmó la cantidad en el presupuesto y se reabrió el APU guardado. La sustitución de fórmula por número también pasó. Cero errores JavaScript.
- Los valores de prueba quedaron restaurados. El presupuesto total volvió a `738462025`; las cantidades continúan identificadas como referenciales y `contract_amount` permanece nulo. El borrador vigente preparado para continuar es `00944c00-4469-4484-b550-4a18962ab256`.
- Se reabrió la URL original de la importación después de editar: redirigió a ese mismo borrador vigente, con 597 partidas y sin recrear la obra. [Retomar el workspace de Iasa](https://control-de-facturas-iasa.vercel.app/projects/import/a1f6d97f-ba60-4806-aabe-50ea771a107d).
- Se descargó el original con la sesión autenticada de esa empresa y se calculó su SHA-256: `6c481dd5f9aa1ce1b3df565ea6b6f2b996f4d26d5dddcf670e946098e3d0a33e`, idéntico a la fuente inicial. La sesión importadora está `CONFIRMED`, revisión 2. Las ediciones operativas no modificaron el archivo.
- Evidencias privadas, fuera de Git: `iasa-business-result.json`, `iasa-editing-result.json`, `iasa-created-workspace.png` e `iasa-apu-editing.png`, en `audit-artifacts/workbook-linked-import/`. Los scripts de producción comprobaron empresa y cuenta antes de escribir y guardaron respaldo de los valores probados.

## Propagación de cantidades y APU — 30 de octubre de 2026

El workspace operativo calcula una proyección común con los mismos `budget_items` y componentes APU que usa Costeo. Cada distribución mensual se toma de `budget_items.workbook_schedule`, vinculada al ID de partida; editar su código visible no rompe esa relación.

- Cambiar una cantidad recalcula el presupuesto de venta, costo directo y necesidades del borrador. **Confirmar** aplica la cantidad a `budget_items` y actualiza `projects.budget_total` en la misma transacción para las obras importadas. Incluye disminuciones y conserva el monto contractual separado.
- **Guardar componente** aplica el APU a las tablas operativas existentes y actualiza las entradas de la proyección del workspace. Los costos usan el selector vigente del ERP y el precio documental de respaldo; el precio de venta conserva su edición independiente.
- Los montos y materiales por mes usan las proporciones verificadas del documento, multiplicadas por cantidades y consumos vigentes. Los meses concilian con los totales; un precio, cantidad o vínculo faltante queda pendiente de forma explícita. Los días y el plan documental se conservan. El Gantt con fechas explícitas mantiene su prioridad en Informes.
- **Materiales**, **Costeo → Insumos** e **Informes** leen las mismas identidades y relaciones operativas. La Curva S de Informes usa la distribución vigente para las obras con cronograma relativo importado. Las necesidades de cotización leen todas las páginas de partidas y materiales, evitando el recorte a 1.000 filas en esta planilla de 2.199 relaciones de materiales.
- `/api/projects/[id]/operational-projection` entrega la proyección del cómputo confirmado, con autenticación, plan, rol, empresa y respuesta privada sin caché. El workspace puede mostrar su borrador antes de confirmar; los demás módulos usan las cantidades confirmadas.
- Código de aplicación: `81c57d4c644e589f63bd18af74e158835e46f155`. QA: `dpl_Gr8PhzYJw2SFM2EPTUQdGCRqN2T9`, `READY`. La migración `workspace_live_budget_total` modifica el motor de confirmación existente sin cambiar sus permisos, atomicidad, control de revisión ni comportamiento de licitaciones. Versiones aplicadas: QA `20261030150056`, producción `20261030153527`; el archivo usa la versión de producción.
- La prueba local y desplegada en QA pasó con cantidad `1 → 2 → 1.125 → 1` y consumo `1 → 1.125 → 1`. Comparó el total de la obra guardado, costo APU, sumas por mes, necesidades globales y mensuales, workspace, Costeo e Informes; verificó preservación del monto contractual y los meses documentales. Todos los valores probados quedaron restaurados. Borrador QA final: `57249bb7-cc1a-4ba8-93be-75f4593eb99a`.
- Pasaron 157 casos de regresión seleccionados: 126 de planillas, importación, costeo, fechas y precisión, más 31 de necesidades semanales y propagación de precios. Tres casos conservaron su omisión. TypeScript y lint de los archivos nuevos, workspace e informes pasaron. Los dos archivos antiguos de Costeo conservan sus 25 y 1 errores de lint previos; la comparación con `HEAD` no encontró diagnósticos nuevos en ellos.

La grilla, el presupuesto de venta de Costeo y la proyección comparten `calcLineSubtotal`, el cálculo exacto existente que reproduce `numeric(18,4) × numeric(18,2)` y redondeo por línea a dos decimales. La prueba fraccionaria compara el subtotal de Univer con el subtotal generado por PostgreSQL antes de contrastar los montos mensuales y el total de la obra.

### Resultado en Iasa de producción

- Publicado en `dpl_DfqBDMTnQTKTT891swfgg79svydu`, `READY`, SHA `81c57d4c644e589f63bd18af74e158835e46f155`, idéntico al aprobado en QA. Se restauró la regla manual de build y sólo se reasignó IASA; Bay conserva `dpl_HUAYx9WHRSfpdwAkYHMM387YsTnh`.
- Se repitió el circuito con la administradora de la empresa Iasa (`c040ee03-2302-49d2-8082-b2a4ae5b62af`) y la obra `91e6805f-eda9-4b39-90e5-9c514cc6c896`. Las cuatro comprobaciones de propagación pasaron, incluidas las vistas de Costeo e Informes. Cero errores JavaScript de página.
- Partida 4, Cartel de obra: cantidad `2` y consumo `1` produjeron presupuesto `741010720`, costo directo `561371725.456897` y necesidad del material `2` en el mes 1. Al subir el consumo a `1.125`, la venta se conservó, el costo pasó a `561826270.9114425` y la necesidad a `2.25`.
- Con cantidad `1.125` y consumo original, el presupuesto fue `738780611.88`; la grilla, el subtotal generado por PostgreSQL y Costeo coincidieron. Las sumas mensuales conciliaron con el total de venta y costo en todos los estados probados.
- Tras restaurar cantidad y consumo `1`, presupuesto `738462025`, costo directo `559440896.4153012` y necesidad del material `1`. El precio de origen, el monto contractual y los meses documentales se conservaron. Borrador preparado para continuar: `3490f496-410d-4581-bfab-4e9a40d98e92`.
- La función de confirmación conserva `SECURITY INVOKER`, ejecución autenticada y ejecución anónima revocada. Los contadores de los avisos de seguridad permanecieron iguales antes y después de la migración.
- Evidencia privada: `iasa-editing-result.json` incluye los cuatro estados de la proyección; `iasa-propagation-workspace.png` muestra el cronograma operativo. Las mismas evidencias existen para QA con el prefijo `qa-`.
- Comprobación final: el enlace de la importación retomó ese borrador vigente, conservó los conteos operativos completos y produjo cero errores JavaScript. Se descargó el Excel original con la sesión de Iasa y su SHA-256 sigue siendo `6c481dd5f9aa1ce1b3df565ea6b6f2b996f4d26d5dddcf670e946098e3d0a33e`. En lectura directa de producción, `projects.budget_total` y la suma de subtotales coinciden en `738462025.00`; cantidad y consumo probados están restaurados en `1`.
