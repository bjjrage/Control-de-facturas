# Primer lote: workspace de cómputo, presupuesto y APU

Fecha: 29 de octubre de 2026. Implementación y verificación inicial sobre aplicación local conectada exclusivamente a la base QA `kyiihlkncatojvlasoag`. Publicación en IASA pendiente de cerrar la licencia del motor instalado y verificar el despliegue final.

## Cambios

- Conversión numérica compartida: conserva números nativos, decimales inequívocos y notación científica; rechaza texto inválido y escalas ambiguas con ubicación de la celda. El API legado de porcentajes conserva puntos porcentuales explícitos.
- Presupuesto, certificados, avance, cronograma y adaptador de recetas respetan tipos de celda; un código numérico de error de Excel no se convierte en cantidad.
- Guardado del borrador con revisión esperada y comprobación atómica de estado/revisión. Una respuesta atrasada o fallida no reemplaza la edición más reciente en cola.
- Confirmación mediante RPC que bloquea la revisión revisada; conserva atomicidad, permisos existentes e idempotencia.
- Reapertura del mismo borrador del usuario, fórmulas y valores guardados por separado, descarga de respaldo y advertencia de salida con cambios pendientes.
- Workspace con selección de partida, panel APU, costo unitario y necesidad bruta de materiales para la cantidad editada. Una modificación del APU refresca el panel.
- Las filas vacías de reserva se excluyen de la aplicación; reabrir no produce un guardado fantasma. La grilla admite hasta 5.000 filas.

## Evidencia

El recorrido automático `node scripts/qa/verify-workspace.mjs` usa la URL local o el alias QA permitido y crea únicamente datos identificados como prueba. Exige que las credenciales apunten a la base QA antes de escribir.

Pruebas comprobadas en navegador y API:

1. Crear y retomar el mismo borrador.
2. Rechazar guardado y confirmación de una revisión vieja.
3. Editar `=3+3`, guardar, reabrir y conservar expresión y resultado `6`.
4. Consultar APU con consumo horario `0,125`, sin cambiar su escala.
5. Confirmar cantidad `6`, precio `100` y subtotal `600` en las tablas operativas.
6. Reintentar confirmación sin duplicar y rechazar ediciones posteriores al cierre.
7. Pegar 1.000 celdas, comprobar las 200 filas persistidas y deshacer el pegado.
8. Completar el recorrido sin errores JavaScript de página.

Las pruebas unitarias de importación/planillas pasaron: 81 casos, dos omitidos por sus condiciones preexistentes. También pasaron 75 casos de workspace/costeo, TypeScript y el build inicial. Cualquier cambio posterior requiere sus verificaciones pertinentes.

Las capturas y resultados con datos QA quedan fuera de Git en `audit-artifacts/workbook-linked-import/workspace-qa-result.json`, `workspace-qa.png` y `workspace-bulk-qa.png`.

## Alcance y pendientes

El cómputo y el precio se editan como borrador y se aplican al confirmar. El panel identifica que muestra la receta vigente: editarla usa el circuito APU existente y afecta la obra directamente. Para vincular un APU a una partida nueva primero se confirma su creación. Un borrador único que apruebe simultáneamente todas las recetas queda pendiente; esta entrega no lo presenta como implementado.

La recuperación de trabajo confirmado usa el servidor. Los cambios todavía pendientes permanecen en la pestaña y pueden descargarse; se advierte al salir. La recuperación automática tras un cierre abrupto del navegador y el trabajo offline siguen pendientes.

Las fórmulas del borrador se conservan, pero el cálculo editable sigue usando el motor instalado. La verificación independiente de todas las fórmulas en servidor y la cobertura completa de funciones no quedan certificadas por estas pruebas.

Handsontable y HyperFormula siguen instalados como motor existente. La grilla declara una clave de evaluación. Antes de ampliar su uso en IASA hay que comprobar licencia comercial o completar el experimento y la migración a un motor compatible. No se modificó esa clave para simular una licencia.

La migración SQL de este lote fue aplicada sólo en QA. IASA requiere la misma función y una revisión de aplicación que haya pasado la verificación final.
