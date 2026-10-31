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

## Evidencia de publicación — 31/10/2026

- Código publicado: `83e6421cdb3b95e84af9d224ff175c7af2a1c1ce`, rama `codex/import-integrity`.
- QA: `dpl_5NgCw1B1W9bT6upgaRYWKdioJMKo`, alias `control-de-facturas-git-main-marceloechauri-4623s-projects.vercel.app`.
- IASA: `dpl_B73oQ1CV4vpwYeRBFyrpKfyUwEfU`, alias `control-de-facturas-iasa.vercel.app`. Bay conserva su despliegue `dpl_HUAYx9WHRSfpdwAkYHMM387YsTnh`.
- Ambos builds remotos llegaron a READY. La migración aditiva fue aplicada primero en QA y después en producción. La excepción `exit 1` se pasó por despliegue; `updatedAt` de la configuración del proyecto permaneció en `1792859512221` antes y después. El conector no expone el comando persistente y la CLI local no tenía credenciales, por lo que no se afirma una lectura directa de ese campo ni se sobrescribió la configuración general.
- Suite focalizada: 41 pruebas aprobadas y 2 pruebas opcionales preexistentes omitidas. La prueba privada con este archivo sí se ejecutó. TypeScript, ESLint y comprobación de diferencias aprobados.
- QA: subida real, análisis nuevo de Luna sobre las 15 hojas y creación de obra. Se verificaron 53 partidas, 53 líneas del certificado, 25 personas, 2 curvas, 191 jornadas operativas y 22 entradas de avance.
- Pruebas de la función de jornadas: repetición idempotente; rechazo de fechas duplicadas, cambios contradictorios, fechas futuras y obra no autorizada. Los intentos rechazados conservaron el estado y no dejaron eventos huérfanos.
- Navegación autenticada sobre los despliegues remotos de QA e IASA: presupuesto, certificados, avance físico y cronograma devolvieron HTTP 200 y cero errores JavaScript. Se comprobó la curva y su editor al 100 %, las jornadas 57/29/21, el certificado 6 por 623.788.012 PYG y el presupuesto por 3.482.791.500 PYG.

La reparación de la obra existente se ejecutó únicamente sobre el proyecto diagnosticado, con comparación de valores previos para evitar pisar ediciones concurrentes: inicio/orden 09/02/2026, plazo 175 días, fin sin inferir, 13 filas mensuales corregidas y 191 jornadas incorporadas. La lectura posterior verificó que presupuesto, certificado, avance, versiones de curvas, histórico y copia original permanecieron intactos. Quedó un evento de auditoría `project.workbook_integrity_repaired` con hashes antes/después y la discrepancia del día adicional.

Las evidencias privadas y capturas se guardan localmente en `audit-artifacts/import-integrity/`, excluido de Git. La obra en QA queda disponible para revisión. El día adicional sin fecha y la ausencia de fechas por partida para Gantt siguen siendo limitaciones explícitas de la fuente, no datos completados automáticamente.
