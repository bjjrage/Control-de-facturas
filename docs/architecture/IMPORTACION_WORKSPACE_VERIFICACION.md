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

Resultado local con base QA: 597 partidas, 597 APU, 597 plazos relativos, 2.199 relaciones de materiales, 1.200 de mano de obra, 896 de equipos, 346 de transporte y una curva general. La publicación queda supeditada a repetir el circuito en el despliegue QA de la revisión final.

La comprobación anterior de producción se ejecutó con una cuenta de niu.pack sobre el dominio IASA. No prueba datos de la empresa Iasa; el informe del primer lote se corrigió para explicitar esta diferencia.
