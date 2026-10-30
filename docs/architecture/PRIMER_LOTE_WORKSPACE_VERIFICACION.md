# Primer lote: workspace de cómputo, presupuesto y APU

Publicado en IASA el 30 de octubre de 2026, después de la verificación local y del circuito completo desplegado en QA. Motor seleccionado: núcleo de Univer 1.0.2, Apache 2.0.

## Estado de entrega al 30 de octubre de 2026

- Código de aplicación verificado: `148ab66f3c48605b507152908c9cb21a56b2bcad`.
- Despliegue QA listo y probado: `dpl_Hrvy9e7pnbxk3BTWVtmWL9mrqqEj`.
- [Abrir QA](https://control-de-facturas-git-main-marceloechauri-4623s-projects.vercel.app).
- Pasaron 161 pruebas de regresión y, por separado, la prueba del archivo real. TypeScript y el build limpio pasaron.
- El navegador desplegado en QA comprobó fórmula y descripción editadas por teclado, guardado/reapertura, APU, necesidad de 1,65 kg, pegado de 1.000 celdas, deshacer restaurado en base, confirmación idempotente, rechazo de revisiones viejas y libro de 597 partidas con estado referencial visible. No hubo errores JavaScript de página.
- La función de confirmación está aplicada en QA y producción, con `SECURITY INVOKER`, acceso autenticado y sin permiso para `anon`.
- [IASA publicado](https://control-de-facturas-iasa.vercel.app): despliegue `dpl_HRRy9FqBXMVhkR2ek3fhkzHTFGQh`, estado `READY`, mismo código `148ab66f3c48605b507152908c9cb21a56b2bcad` que QA.
- Pasó el smoke test autenticado de producción: proyectos, API del workspace, grilla Univer, RPC de revisión desplegado y rechazo de acceso anónimo. Sin errores JavaScript de página ni escrituras en presupuesto, compras o stock.
- El usuario autorizó explícitamente `projectSettings.commandForIgnoringBuildStep: "exit 1"` para ejecutar este build completo. Después se restauró la regla manual original y se asignó únicamente el dominio IASA.

Acceso al workspace: abrir una obra, entrar en Presupuesto y elegir **Abrir workspace de obra**. La regla de producción vuelve a cancelar builds automáticos con `IASA estable: publicacion manual`; las publicaciones futuras siguen requiriendo una acción manual. No se realizó una promoción global de dominios.

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
- La lectura de partidas y componentes de costeo se pagina; una prueba de 1.201 partidas comprueba que no se recorta al límite de transporte. El formato vacío del motor no genera una revisión nueva al reabrir.

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

Las pruebas unitarias de importación/planillas pasaron: 86 casos, tres omitidos por sus condiciones preexistentes o por requerir el archivo privado. También pasaron 75 casos de workspace/costeo, TypeScript y el build inicial. La prueba del archivo real se ejecutó por separado y pasó. Cualquier cambio posterior requiere sus verificaciones pertinentes.

Una regresión independiente del modelo, ejecutada con el archivo real y su mapeo guardado, preservó 597 partidas, 597 recetas, 597 plazos relativos, el total de 738.462.025 y la huella del original. Se ejecuta con `WORKBOOK_REGRESSION_PATH` y `WORKBOOK_REGRESSION_MAPPING_PATH`; no incluye archivos privados ni requiere otra llamada a Luna.

Las capturas y resultados con datos QA quedan fuera de Git en `audit-artifacts/workbook-linked-import/workspace-qa-result.json`, `workspace-qa.png` y `workspace-bulk-qa.png`.

## Alcance y pendientes

El lint de las piezas nuevas pasa. `costeo-actions.ts` conserva 25 errores de `no-explicit-any` y dos advertencias preexistentes; la comparación contra la base anterior confirmó el mismo resultado antes y después de la paginación. Este lote no declara limpio el lint global del repositorio.

El cómputo y el precio se editan como borrador y se aplican al confirmar. El panel identifica que muestra la receta vigente: editarla usa el circuito APU existente y afecta la obra directamente. Para vincular un APU a una partida nueva primero se confirma su creación. Un borrador único que apruebe simultáneamente todas las recetas queda pendiente; esta entrega no lo presenta como implementado.

La recuperación de trabajo confirmado usa el servidor. Los cambios todavía pendientes permanecen en la pestaña y pueden descargarse; se advierte al salir. La recuperación automática tras un cierre abrupto del navegador y el trabajo offline siguen pendientes.

Las fórmulas del borrador se conservan, pero el cálculo editable sigue usando el motor instalado. La verificación independiente de todas las fórmulas en servidor y la cobertura completa de funciones no quedan certificadas por estas pruebas.

La selección de motor se resolvió con Univer después de confirmar que IASA no tiene licencia comercial de Handsontable/HyperFormula. Se usan los paquetes del núcleo Apache 2.0 ya presentes en el ERP. Los módulos comerciales de Univer no forman parte de esta entrega. El aviso y la licencia se distribuyen en `public/licenses/`.

El alcance operativo conserva las seis columnas de cómputo/presupuesto. La creación de hojas auxiliares y los cambios de columnas pertenecen a P4. Las operaciones que podrían mover valores sin su identidad se bloquean; las filas completas mantienen sus vínculos. Esto no representa una certificación de compatibilidad con todas las funciones de Excel.

La función SQL fue aplicada en QA como `20261030011748` y en producción como `20261030023454`, después de pasar el circuito desplegado de QA. El archivo del repositorio usa la versión de producción. La aplicación de producción pasó la verificación final y el dominio IASA quedó asignado explícitamente al despliegue indicado arriba.

La autoasignación de dominios de Vercel se desactivó para realizar publicaciones selectivas por alias. El proyecto comparte IASA y Bay; esta entrega asigna únicamente IASA una vez verificada la revisión.
