# Workspace de presupuesto y APU — primer lote

Entrada: obra → Preparar → Presupuesto → **Abrir workspace de presupuesto y APU**.
Ruta: `/projects/:id/workspace`. Abre a pantalla completa; permite reducirla y volver a la vista anterior.

## Operación

- Las filas son las partidas existentes de `budget_items`, con todos los registros paginados. No hay un presupuesto paralelo.
- Se editan descripción, unidad, cantidad y precio unitario. Los códigos y subtotales están protegidos.
- Doble clic/Enter abre una celda; Enter y Tab confirman y navegan. Escape cancela la celda.
- Ctrl+C copia una celda sin formato de miles. Ctrl+V pega un rectángulo desde la celda seleccionada, sobre las filas visibles. Un error rechaza todo el pegado.
- Cantidades: hasta 4 decimales. Precios: hasta 2. Coma o punto decimal, sin agrupadores de miles. Valores ambiguos como `1.234` requieren aclaración; `1,2340` expresa el decimal y `1234` el entero.
- Las celdas modificadas se marcan. **Guardar cambios** aplica las modificaciones al presupuesto operativo; **Deshacer** funciona antes del guardado y **Descartar pendientes** requiere confirmación.
- El borrador se conserva en `sessionStorage`, por usuario y obra, en esa pestaña. No es un borrador compartido ni un respaldo del servidor.
- El subtotal y el total muestran los valores guardados. La base recalcula `subtotal` con su columna generada; el workspace no introduce otro motor financiero.

## APU y vínculos

Seleccionar una partida habilita **Abrir APU y materiales**. Se utiliza el diálogo existente, incluyendo mano de obra, equipos, subcontratos e importadores existentes.

En el workspace se puede editar consumo y desperdicio de cada material existente con **Guardar material**. Esta operación se guarda por separado del borrador de presupuesto y conserva el precio de origen, la procedencia y la identidad del vínculo partida/producto. La cantidad de la partida debe estar guardada antes de editar su receta.

Los costos y necesidades se consultan por los servicios existentes del ERP. Cambiar un coeficiente no sustituye el precio contractual. Las fechas y dependencias del cronograma se gestionan en Cronograma/Gantt; este lote no deriva fechas automáticamente de cantidades o APU. Los certificados históricos permanecen como sus documentos y cantidades del período, sin recalcularse al editar el presupuesto.

## Guardado y concurrencia

La acción exige el mismo plan y roles que el editor anterior, verifica la empresa propietaria y utiliza el cliente autenticado sujeto a RLS. Cada fila se actualiza solo si sus campos editables siguen iguales a los leídos al comenzar la edición. No escribe códigos, fechas, jerarquía, vínculos de APU ni certificados.

El guardado se divide en lotes de hasta 50 filas. Cada fila es atómica; el conjunto puede tener resultados parciales. Las filas confirmadas se retiran del borrador y los errores permanecen visibles y pendientes. Si cambia una fila en otra sesión, **Revisar y reaplicar** muestra los valores actuales y propuestos y pide una decisión explícita antes de preparar otro guardado.

Los materiales del APU tienen también comparación de sus coeficientes anteriores. Si la receta cambió, debe reabrirse para revisar los datos actuales.

No requiere cambios de esquema ni migraciones. La grilla utiliza `react-data-grid` con licencia MIT; no requiere una licencia comercial de planillas.

## Verificación del lote

Pruebas de código: pegado rectangular, decimales, nulos/cero, precisión de la base, columnas protegidas, autorización por empresa y obra, conflictos, resultados parciales y conservación de precio/procedencia del APU. Se incluye la regresión de cálculos de costeo existentes.

Prueba funcional en QA con la obra de 597 partidas: abrir desde Presupuesto, editar y recuperar borrador, guardar y reabrir, comprobar subtotal persistido, simular otra edición, revisar conflicto, modificar consumo de material y comprobar el presupuesto, costo y necesidades en la vista de Costeo. Se restauran las cantidades y coeficientes de prueba. IASA se comprueba en lectura después de pasar QA.
