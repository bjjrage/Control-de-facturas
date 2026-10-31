# Contratos de entrada de la importación

Continuación del trabajo de integridad sobre IASA estable. Este lote amplía los controles del importador existente y conserva los módulos operativos y el flujo de revisión.

## Antes de crear la obra

- Las tablas de presupuesto, certificado y avance requieren columnas no ambiguas, dentro de su origen. Las matrices de calendario y Curva S usan sus propios contratos; las columnas repetidas de valores son válidas allí.
- Una partida ejecutable necesita código, descripción, unidad, cantidad y precio. Los códigos duplicados, las filas con datos que no pudieron extraerse y las inconsistencias aritméticas bloquean la carga.
- Un texto, error de Excel, fecha, porcentaje o fórmula sin resultado no se convierte en un cero numérico. Se conserva el cero numérico real. Los separadores y prefijos monetarios habituales siguen admitidos.
- Cantidades con precisión superior a cuatro decimales y precios superiores a dos decimales se señalan antes de que la base los redondee.
- Los totales declarados se contrastan en su escala: origen y, cuando existe una relación de escala verificada por las cantidades, contrato completo.
- Los errores de secciones opcionales bloquean su aplicación cuando están seleccionadas. Avance sin partida válida no se carga como un subconjunto silencioso.
- Regiones sin resolver y dominios sin integración operativa requieren aceptación explícita. APU y BOM siguen sin integración en esta rama; no se anuncian como importados. Los bloques reconocidos como otra obra quedan fuera.
- El servidor vuelve a ejecutar la validación; el estado habilitado del botón del navegador no autoriza una escritura inválida. Se comprueban también las dependencias de certificado y las capacidades del plan antes de crear el proyecto.

## Después de guardar

La lectura completa usa páginas ordenadas y el conteo exacto del Data API. Una respuesta truncada no se acepta como verificación completa. Se comparan partidas (incluidas unidades, descripción y jerarquía), certificado (cabecera, cada línea y vínculo), personal, avance (cantidad, fecha y partida), versiones de curva y jornadas operativas.

Una falla de persistencia sigue informándose como pendiente en el resultado y la auditoría. Este lote no convierte toda la creación en una única transacción ni agrega un reintento sobre obras parciales.

## Validación y límites

Las pruebas incluyen tres disposiciones de presupuesto, valores inválidos y faltantes, duplicados, errores y formatos de celda, precisión, certificado, avance sin vínculo, secciones sin integración, escala contractual y respuestas paginadas o truncadas. El archivo real se verifica desde Excel, copia guardada y reapertura; la obra existente de QA se relee sin modificarla.

Esto verifica contratos de datos y su persistencia. No demuestra que Luna interprete correctamente cualquier archivo ni que todo el contenido de cualquier hoja tenga una integración disponible. Las pruebas con nuevas subidas y sus resultados de publicación se registran después de la verificación en QA.
