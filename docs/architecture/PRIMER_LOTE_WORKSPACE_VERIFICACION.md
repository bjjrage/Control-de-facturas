# Primer lote: workspace de cómputo, presupuesto y APU

Fecha: 29 de octubre de 2026. Implementación y verificación inicial sobre aplicación local conectada exclusivamente a la base QA `kyiihlkncatojvlasoag`. Motor seleccionado: núcleo de Univer 1.0.2, Apache 2.0. Publicación en IASA pendiente de verificar el despliegue final.

## Cambios

- Conversión numérica compartida: conserva números nativos, decimales inequívocos y notación científica; rechaza texto inválido y escalas ambiguas con ubicación de la celda. El API legado de porcentajes conserva puntos porcentuales explícitos.
- Presupuesto, certificados, avance, cronograma y adaptador de recetas respetan tipos de celda; un código numérico de error de Excel no se convierte en cantidad.
- Guardado del borrador con revisión esperada y comprobación atómica de estado/revisión. Una respuesta atrasada o fallida no reemplaza la edición más reciente en cola.
- Confirmación mediante RPC que bloquea la revisión revisada; conserva atomicidad, permisos existentes e idempotencia.
- Reapertura del mismo borrador del usuario, fórmulas y valores guardados por separado, descarga de respaldo y advertencia de salida con cambios pendientes.
- Workspace con selección de partida, panel APU, costo unitario y necesidad bruta de materiales para la cantidad editada. Una modificación del APU refresca el panel.
- Las filas vacías de reserva se excluyen de la aplicación; reabrir no produce un guardado fantasma. La grilla admite hasta 5.000 filas.
- El workspace se presenta por encima de la navegación general y conserva los diálogos accesibles. El pegado no envía metadatos de identidad a columnas del motor de fórmulas.
- Handsontable y HyperFormula fueron retirados de la grilla y de las dependencias. Univer conserva IDs en una columna interna y las revisiones fuera de los valores editables; el guardado espera a que se apliquen los resultados de cálculo.

## Evidencia

El recorrido automático `node scripts/qa/verify-workspace.mjs` usa la URL local o el alias QA permitido y crea únicamente datos identificados como prueba. Exige que las credenciales apunten a la base QA antes de escribir.

Pruebas comprobadas en navegador y API:

1. Crear y retomar el mismo borrador.
2. Rechazar guardado y confirmación de una revisión vieja.
3. Editar `=3+3`, guardar, reabrir y conservar expresión y resultado `6`.
4. Consultar APU con consumo horario `0,125`, sin cambiar su escala.
5. Confirmar cantidad `6`, precio `100` y subtotal `600` en las tablas operativas.
6. Reintentar confirmación sin duplicar y rechazar ediciones posteriores al cierre.
7. Pegar 1.000 celdas, comprobar las 200 filas persistidas y deshacer el pegado en una sola acción, comprobando restauración en base de datos.
8. Completar el recorrido sin errores JavaScript de página.
9. Abrir el editor APU y comprobar 1,65 kg de necesidad bruta para 6 unidades, consumo 0,25 kg/u y merma 10 %.

Las pruebas unitarias de importación/planillas pasaron: 84 casos, tres omitidos por sus condiciones preexistentes o por requerir el archivo privado. También pasaron 75 casos de workspace/costeo, TypeScript y el build inicial. La prueba del archivo real se ejecutó por separado y pasó. Cualquier cambio posterior requiere sus verificaciones pertinentes.

Una regresión independiente del modelo, ejecutada con el archivo real y su mapeo guardado, preservó 597 partidas, 597 recetas, 597 plazos relativos, el total de 738.462.025 y la huella del original. Se ejecuta con `WORKBOOK_REGRESSION_PATH` y `WORKBOOK_REGRESSION_MAPPING_PATH`; no incluye archivos privados ni requiere otra llamada a Luna.

Las capturas y resultados con datos QA quedan fuera de Git en `audit-artifacts/workbook-linked-import/workspace-qa-result.json`, `workspace-qa.png` y `workspace-bulk-qa.png`.

## Alcance y pendientes

El cómputo y el precio se editan como borrador y se aplican al confirmar. El panel identifica que muestra la receta vigente: editarla usa el circuito APU existente y afecta la obra directamente. Para vincular un APU a una partida nueva primero se confirma su creación. Un borrador único que apruebe simultáneamente todas las recetas queda pendiente; esta entrega no lo presenta como implementado.

La recuperación de trabajo confirmado usa el servidor. Los cambios todavía pendientes permanecen en la pestaña y pueden descargarse; se advierte al salir. La recuperación automática tras un cierre abrupto del navegador y el trabajo offline siguen pendientes.

Las fórmulas del borrador se conservan, pero el cálculo editable sigue usando el motor instalado. La verificación independiente de todas las fórmulas en servidor y la cobertura completa de funciones no quedan certificadas por estas pruebas.

La selección de motor se resolvió con Univer después de confirmar que IASA no tiene licencia comercial de Handsontable/HyperFormula. Se usan los paquetes del núcleo Apache 2.0 ya presentes en el ERP. Los módulos comerciales de Univer no forman parte de esta entrega. El aviso y la licencia se distribuyen en `public/licenses/`.

El alcance operativo conserva las seis columnas de cómputo/presupuesto. La creación de hojas auxiliares y los cambios de columnas pertenecen a P4. Las operaciones que podrían mover valores sin su identidad se bloquean; las filas completas mantienen sus vínculos. Esto no representa una certificación de compatibilidad con todas las funciones de Excel.

La migración SQL de este lote fue aplicada sólo en QA. IASA requiere la misma función y una revisión de aplicación que haya pasado la verificación final.
