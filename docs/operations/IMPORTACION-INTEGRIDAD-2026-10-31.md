# Integridad de la importación de obra

Base de la corrección: IASA estable, commit `9dba47ce`. No incorpora el workspace posterior ni cambia los módulos operativos.

## Defectos corregidos

- El formato numérico se conserva en la representación de celdas, la copia guardada y la reconstrucción desde la grilla. Los porcentajes usan ese formato, incluso cuando el editor descarta el texto visible.
- Las fechas de obra requieren rótulos contractuales verificables. El período de un certificado no se convierte en inicio/fin de obra. Orden de inicio y plazo en días se guardan por separado; no se inventa una fecha final.
- Los encabezados explícitos de un certificado permiten recuperar número y período cuando el modelo omite esos campos. Identidades contradictorias quedan sin resolver.
- La curva con escala incorrecta se bloquea antes de escribir; la selección y la aceptación de observaciones se validan nuevamente en el servidor.
- Las jornadas se escriben en `project_workday_status`, el registro que consume el calendario, mediante una función autenticada, con permisos del usuario, trazabilidad por celda, transacción y lectura posterior. Se usan las mismas clasificaciones y restricciones que en la carga manual. No se inventan mediciones meteorológicas.
- La repetición de jornadas idénticas es idempotente. Se rechazan duplicados, conflictos, fechas futuras o anteriores al inicio, y obras ajenas.
- Se releen fechas, presupuesto, certificado, curvas y calendario antes de informar el resultado. Una importación con pendientes se identifica como tal.

## Prueba real y límites

Archivo privado: P05 / ID14 / SIPP3458 / certificado 6. SHA-256:
`f36454942485c43c70320d49b59dff1509d64aa06c1f9b0a03e7241da5b57372`.

Resultados esperados: 53 partidas; presupuesto 3.482.791.500 PYG; certificado 6, período 21/07–20/08/2026; orden de inicio 09/02/2026; plazo 175 días; dos curvas (100 % y 99,99 % por redondeo de origen); 191 fechas con códigos B84 / LL57 / HH29 / O21.

El resumen de febrero suma un día adicional mediante `COUNTIF(...,"O")+1`: el libro contiene 107 días no trabajados con fecha y mantiene la diferencia como pendiente. No se asigna una fecha al adicional. La programación del archivo es financiera mensual; no hay fechas por partida para un Gantt.

Las pruebas unitarias incluyen celdas, formato, guardado/reapertura, escalas incorrectas, fechas contractuales, discrepancias y duplicados. La prueba privada real se ejecuta con `WORKBOOK_OPERATIONAL_SESSION` apuntando al JSON local de la sesión; no publica el Excel ni los datos privados. QA usa su propia base y cuenta autenticada.

## Publicación

La migración agrega solamente `import_workbook_workdays`; no modifica filas existentes. El despliegue de esta rama requiere esa función. IASA y QA se publican por separado. Reparar una obra ya importada exige comparar sus valores actuales con el diagnóstico, conservar el original y registrar los cambios; no ejecutar un backfill general.
