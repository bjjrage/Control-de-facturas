# Importación directa al workspace

El archivo se guarda en una sesión y abre `/projects/import/[id]`, una página de trabajo recuperable desde **Obras → Planillas en preparación**. La obra se crea sólo al confirmar la revisión guardada. Esta entrega conecta la entrada de Excel con las vistas nativas del primer lote.

## Comportamiento

- Partidas: grilla Univer, fórmulas propias, pegado, cantidades y precios adoptados. Identidad, descripción y unidad del archivo se conservan durante la vinculación; el workspace operativo permite su edición tras crear la obra.
- APU: receta por partida, consumos, precios y celdas de procedencia. El editor operativo existente se habilita al crear la obra.
- Materiales: necesidades por consumo de cada APU y cómputo del borrador; navegación a las partidas que las originan. Tras crear la obra se consultan las relaciones y mermas vigentes del ERP.
- Cronograma: vínculos demostrados por fórmulas hacia las partidas fuente y encabezados de cada sección. Los códigos de equipos no se vinculan por mera igualdad numérica. La curva general se deriva de la distribución monetaria completa reconciliada con cada partida, conservando los valores del documento.
- Original: copia de la fuente en consulta; archivo inmutable conservado en Storage. El borrador operativo vive en `workspace_draft`, separado de las celdas fuente.
- Guardado por empresa, rol y revisión esperada. La creación reextrae y valida en servidor, aplica el borrador guardado y usa la transacción existente con bloqueo de revisión e idempotencia. Las fórmulas nuevas revisadas se conservan al abrir el primer borrador operativo.

Las cantidades referenciales siguen identificadas. Cambiar el cómputo actualiza presupuesto y necesidades; no redistribuye automáticamente los días ni los importes mensuales documentales. Este cambio no certifica recálculo universal de Excel ni compatibilidad con cualquier formato de APU.

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
