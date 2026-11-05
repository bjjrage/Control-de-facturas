# Plantillas de entrada del ERP — versión 1

Definidas contra el código consolidado del ERP. Esta entrega define campos y ofrece archivos vacíos para las rutas existentes; no agrega un importador universal ni cambia cálculos, tarifas, certificados o permisos.

## Empezar una obra

Crear la ficha de obra y cargar el presupuesto contractual. Con partidas, unidades, cantidades y precios reales se puede registrar avance y preparar certificados. APU y cronograma son entradas adicionales para funciones específicas; no son requisitos para certificar.

Si la obra ya está en ejecución, conciliar primero los antecedentes. El importador de certificados existente exige secuencia y compara el anterior con el ERP. Un certificado N.º 6 aislado no sustituye automáticamente los cinco anteriores. Un flujo de saldo inicial de migración queda pendiente de implementación; no fabricar historial para superar esa validación.

## Archivos disponibles

Cada XLSX tiene Datos como primera hoja y Guia como segunda. No contiene ejemplos de negocio ni fórmulas: se evita importar valores ficticios. Los códigos están formateados como texto, las cantidades como números y las fechas se ingresan AAAA-MM-DD. Las ayudas y validaciones de Excel no reemplazan la validación del servidor.

| Archivo | Columnas | Uso actual |
| --- | --- | --- |
| [01-presupuesto.xlsx](plantillas/01-presupuesto.xlsx) | Codigo, Descripcion, Unidad, Cantidad, Precio unitario; Fecha inicio y Fecha fin opcionales | Importar Excel en Presupuesto. Agrega partidas, no actualiza cargas anteriores. |
| [02-certificacion-periodo.xlsx](plantillas/02-certificacion-periodo.xlsx) | Codigo, Presente | Copiar/pegar en Pegar avance del mes de un certificado BORRADOR. No es subida de archivo ni parte diario. |
| [03-certificado-historico.xlsx](plantillas/03-certificado-historico.xlsx) | Número y período en encabezado; Codigo, Descripcion, Unidad, Cantidad contractual, Cantidad anterior, Cantidad presente, Precio unitario | Importar certificado XLSX, interpretar y revisar. Respetar secuencia. |
| [04-apu-materiales.xlsx](plantillas/04-apu-materiales.xlsx) | PARTIDA_CODIGO, PRODUCTO_CODIGO, CANTIDAD, DESPERDICIO_PCT | APU > Materiales. Partida y producto deben existir. |
| [05-apu-mano-obra.xlsx](plantillas/05-apu-mano-obra.xlsx) | PARTIDA_CODIGO, ROL, HORAS, COSTO_HORA | APU > Mano de obra. Jornales tiene prioridad cuando encuentra la categoría. |
| [06-apu-equipos.xlsx](plantillas/06-apu-equipos.xlsx) | PARTIDA_CODIGO, TIPO_EQUIPO, HORAS, COSTO_HORA | APU > Equipos. Horas por unidad de partida. |
| [07-apu-subcontratos.xlsx](plantillas/07-apu-subcontratos.xlsx) | PARTIDA_CODIGO, DESCRIPCION, PRECIO_UNIDAD | APU > Subcontratos. Costo por unidad de partida. |
| [08-cronograma.xlsx](plantillas/08-cronograma.xlsx) | Codigo, Descripcion, Inicio, Fin, Predecesora | Importar cronograma sobre partidas existentes. Una predecesora por partida, según el modelo actual. |

## Qué significa cada cantidad

- Presupuesto: cantidad total contractual. Un 1 de referencia de una planilla de precios no demuestra que esa sea la cantidad de obra.
- Parte diario: cantidad físicamente ejecutada en una fecha.
- Certificado: cantidad aceptada para ese período. El ejecutado puede ser distinto del certificado.
- APU materiales: consumo de material por una unidad de partida. La unidad proviene del catálogo; verificar conversiones antes de cargar.
- APU mano de obra/equipo: horas por unidad de partida. No equivalen a duración calendario.
- BOM: necesidad calculada a partir de cantidades y recetas. No cargar otra suma manual como si fuera stock.

## Qué conserva y calcula el ERP

Se mantienen las funciones existentes: importBudgetItems, addExecutionEntry, createCertificate, bulkSetCertificatePresente, importCertificateWorkbook, los resolutores APU y applyScheduleImport.

Presupuesto calcula importes desde cantidad y precio contractual. Certificados toma antecedentes y ejecución del período, conserva revisión/estados y redondeo existentes, y mantiene su circuito de facturación. Costeo utiliza las fuentes de precio vigentes y las referencias de origen según la prioridad ya publicada. Las plantillas no cambian ninguna de esas reglas.

Acumulados, importes calculados, saldos, BOM consolidado, estado de aprobación, factura y cobro no se escriben como columnas libres de estos archivos. Los descuentos y anticipos del certificado se gestionan en su pantalla; no se supone que el importador histórico los absorba.

El cargador APU de materiales acepta coeficiente y desperdicio, pero no precio de origen. No se agrega una columna de precio que el cargador ignoraría. Los precios se gestionan en los flujos de precio existentes.

## Campos definidos sin prometer una carga masiva inexistente

| Ficha | Campos existentes | Vía actual |
| --- | --- | --- |
| Obra | Nombre y código obligatorios; cliente, ubicación, inicio, fin y presupuesto estimado en Gs opcionales | Crear manualmente; importación interpretada de workbook cuando corresponda. |
| Parte diario | Partida, fecha real, cantidad ejecutada > 0; observaciones y fotos opcionales | Registrar parte diario. Pendiente un cargador tabular independiente. |
| Jornadas | Fecha y tipo B, LL, HH u O; respaldo según el flujo | Calendario y workbook interpretado. Pendiente un cargador tabular independiente. |

Los antecedentes completos de certificados pueden incorporarse con el circuito secuencial existente. Un saldo inicial independiente necesita diseño y validación propios antes de ofrecerse.

## Reglas de uso y límites

1. Una obra por archivo; seleccionar empresa y obra en el ERP. No importar IDs internos ni cambiar la empresa desde una celda.
2. Un registro por fila; sin celdas combinadas ni subtotales dentro del detalle. Conservar códigos y unidades.
3. No representar desconocidos como cero. Usar cantidades y precios numéricos de Excel para evitar ambigüedad de separadores. Revisar monedas: estas tablas no hacen conversión automática.
4. Preservar el original. Si se copia un resultado de fórmula, recalcular y guardar primero en Excel y conciliar los importes. El valor cacheado no prueba que el origen esté actualizado.
5. Revisar todas las correspondencias. Luna propone interpretaciones; la confirmación y las validaciones siguen siendo obligatorias.
6. El importador de presupuesto agrega filas y el pegado masivo no tiene garantía transaccional global: no reintentar una carga parcialmente aplicada como si nada se hubiera guardado.
7. Las hojas fuera de estos contratos quedan como respaldo, no como datos operativos inventados.

## Trazabilidad de definición

contratos-v1.json relaciona cada columna con su campo y función real. scripts/imports/generate-templates.mjs genera los ocho archivos usando ExcelJS ya instalado. No se agrega dependencia ni motor de cálculo.

Las pruebas de compatibilidad comprueban la lectura de los archivos y su uso con extractores/resolutores existentes. No equivalen a certificar que Luna interpretará cualquier archivo externo ni que todas las combinaciones se guardan atómicamente.
