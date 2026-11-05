# Operación de main, QA e IASA

Referencia vigente desde la consolidación del 04/11/2026. El informe del 24/10 está conservado en IASA-Y-QA-2026-10-24-HISTORICO.md; sus IDs de despliegue son históricos.

| Uso | Dirección canónica | Datos |
| --- | --- | --- |
| IASA / producción | https://control-de-facturas-iasa.vercel.app | Supabase ezucivipgmbvamhugkbj |
| QA / pruebas | https://control-de-facturas-qa.vercel.app | Supabase kyiihlkncatojvlasoag |
| Bay / versión anterior conservada | https://control-de-facturas-bay.vercel.app | Producción; no es QA |

## Una fuente de código aprobada

- Repositorio: bjjrage/Control-de-facturas. Rama aprobada: main.
- Integrar por PR; no forzar main ni desactivar sus protecciones.
- Las ramas codex/workbook-linked-import y codex/import-integrity son antecedentes. No publicar desde ellas ni confundir su carpeta con main.
- La carpeta principal del usuario debe quedar en main al cerrar la consolidación. Los worktrees históricos permanecen como evidencia.
- /api/version, con sesión iniciada, informa commit completo, entorno y clasificación de la base. No devuelve claves. El entorno QA muestra una franja visible; IASA conserva su diseño.

## Publicación manual por commit

1. Revisar diff y pruebas; integrar el PR en main.
2. Fijar un SHA completo de main y verificar que ninguna modificación posterior se incluya accidentalmente.
3. Crear un único build Preview de ese SHA y verificar /api/version: environment=preview, database=qa, valid=true.
4. Asignar el alias QA al build y ejecutar las comprobaciones de negocio. El alias antiguo que contiene git-main queda como compatibilidad, apuntando al mismo QA; no demuestra la rama desplegada.
5. Crear un build Production del mismo SHA, verificar environment=production, database=production y commit idéntico.
6. Comprobarlo y asignar exclusivamente control-de-facturas-iasa.vercel.app. No promover todos los dominios del proyecto: Bay comparte proyecto Vercel pero conserva su versión.
7. Guardar IDs, SHA, pruebas y referencia de rollback. Un build READY no significa que esté activo en un dominio.

vercel.json desactiva disparos automáticos de Git mediante git.deploymentEnabled=false. Esto evita builds por cada push. Los builds manuales usan la conexión Git existente y el SHA explícito. La regla global de Ignored Build Step y las protecciones permanecen; la excepción commandForIgnoringBuildStep: exit 1 se aplica solo al build autorizado para que efectivamente compile.

Vercel: equipo team_2iwz4A3Ke45gZjqI33t0osg1; proyecto prj_dNjeJzudk7ZqQq7Ts8MA4UApq8fy. Conservar autoAssignCustomDomains=false. No convertir un build Preview en producción: cada entorno compila con sus propias variables.

## Datos y recuperación

Esta consolidación no modifica credenciales, usuarios, datos de negocio ni ejecuta migraciones. Conservar los originales de las planillas. El esquema conserva migraciones históricas que deben conciliarse antes de un futuro db push; ver CONSOLIDACION-2026-11-04.md.

Rollback de aplicación: reasignar solo el alias afectado al build anterior compatible y verificarlo. No restaurar una base vieja sobre datos nuevos.

Los workers Railway tienen su ciclo propio. No se despliega el worker de producción como efecto lateral de una publicación web. No cambió su código en este lote; la configuración histórica se encuentra en el documento del 24/10.

## Plantillas

Definiciones, destino real y estado de soporte: ../imports/PLANTILLAS-ERP-V1.md. Los archivos son entradas para los circuitos existentes; no sustituyen fórmulas ni crean nuevos módulos.
