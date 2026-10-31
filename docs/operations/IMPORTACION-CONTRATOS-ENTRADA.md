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

## Resultado del lote — 31/10/2026

Código publicado: `83402d2e46bacea1449ca26545780bd918ca6483`. QA: `dpl_Gacdo7bdrYuaX99cL5KjLkHHfJ3E`; IASA: `dpl_AN9pBksm2AKtmqJW1Jr7dJWzYzxw`. Ambos builds READY. Se asignó únicamente el alias de IASA; Bay conserva `dpl_HUAYx9WHRSfpdwAkYHMM387YsTnh`. No hubo migraciones ni reparación de datos existentes en este lote.

- 78 pruebas aprobadas y 2 opcionales preexistentes omitidas; el archivo real SIPP sí se ejecutó desde Excel, copia guardada y reapertura. ESLint y TypeScript aprobados.
- Nueva subida con columnas reordenadas y encabezados desplazados: Luna identificó dos partidas y un total de 400.000 PYG; se creó una obra sin certificado y la lectura posterior pasó.
- Nueva subida de ocho hojas: dos partidas por 300.000 PYG, certificado con dos líneas por 60.000 PYG, dos personas, una curva, tres jornadas y dos avances. Se verificaron los dos vínculos certificado–partida y los dos vínculos avance–partida. El APU de referencia se informó como pendiente; no se anunció como aplicado.
- Archivo con texto en el precio: la revisión previa bloqueó la creación. Una llamada directa a la misma acción del servidor, con la sesión inválida, también rechazó el dato y conservó el conteo de obras. Los originales conservaron sus hashes.
- La primera prueba detectó dos fallas del flujo para archivos simples: «Creando obra» se mostraba cuando faltaba elegir régimen y los valores por defecto enviaban secciones inexistentes. Se separó preparación de guardado y se envían únicamente secciones disponibles, con dependencias de certificado. El análisis real de esa primera sesión se retomó después del ajuste, sin reemplazarlo por un resultado simulado.
- Se releían sin diferencias las obras reales existentes en QA e IASA: 53 partidas, 53 líneas de certificado, 25 personas, 22 avances y 191 jornadas, además de fechas y curvas. Después de publicar, presupuesto, certificados, avance físico y cronograma de IASA devolvieron HTTP 200 y cero errores JavaScript.

Las pruebas nuevas usan datos sintéticos en la empresa de QA. Las obras creadas allí permanecen disponibles para revisión. Evidencias privadas: `contract-upload-qa.json`, `contract-existing-{qa,iasa}.json`, `contract-iasa-pages.json` y capturas en `audit-artifacts/import-integrity/`, excluido de Git.
