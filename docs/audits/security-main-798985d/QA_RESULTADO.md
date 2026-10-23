# Validación del candidato de seguridad en QA

Fecha de cierre: 22/10/2026, America/Asuncion.

- PR: [#41](https://github.com/bjjrage/Control-de-facturas/pull/41), contra `main`.
- Base verificada: `798985d355fb8ed96796237e6f198c172db98709`.
- Candidato de código probado: `d85bfb49a56b0420f1cb935043d2202dd0733e1e`.
- Rama: `batch/security-main-798985d`. El commit posterior contiene solo esta evidencia y actualizaciones de los informes.
- Esta sección registra la validación del candidato de seguridad d85bfb4 y la publicación documental 0535e5a0. La ampliación visual autorizada después recupera dos archivos de tarjetas y tiene verificación propia en [UI_TARJETAS_RESULTADO.md](UI_TARJETAS_RESULTADO.md); no cambia backend ni migraciones. Las nueve pruebas históricas de esta sección no se presentan como repetidas sobre ese nuevo commit visual.
- Único backend modificado: Supabase QA `kyiihlkncatojvlasoag`.
- App: build de producción de Next 16.4.2 ejecutado localmente en `http://localhost:3039`, conectado a QA. No se desplegó una app ni un worker.

## Migraciones

| Archivo del repositorio | Resultado en QA |
|---|---|
| `20261022231201_scanner_session_authorization.sql` | Aplicada; historial con esta versión y nombre `scanner_session_authorization`. |
| `20261022231211_sec03_gmail_approval_authority.sql` | Aplicada; historial con esta versión y nombre `sec03_gmail_approval_authority`. |

La herramienta asignó inicialmente los timestamps `20261022234516` y `20261022234724`. Se alinearon únicamente esas dos filas del historial de QA con los timestamps de los archivos, sin volver a ejecutar el SQL. QA pasó de 83 a 85 migraciones. No se aplicó ninguna otra migración. La diferencia previa `20261013153336_fix_accept_quotation_ot_code` quedó fuera de alcance.

El preflight encontró cero aprobaciones antiguas de envío pendientes que retirar. La lógica de invalidación del legado y preservación de intentos se probó con fixtures en PostgreSQL efímero, no mediante alteración de historial real en QA.

Catálogo de QA después de migrar: `anon` sin lectura de scanner; `authenticated` puede leer `id` pero no PIN, hashes ni metadata, y no tiene UPDATE. Sin INSERT/UPDATE cliente en aprobaciones; creación RPC permitida a `service_role` y denegada a `authenticated`. Las llamadas reales a Data API confirmaron los rechazos `42501`.

## Pruebas sobre QA: 9 PASS, 0 fallos pendientes

| Prueba | Evidencia |
|---|---|
| Login y perfiles reales | Cuatro usuarios: admin, administración y comercial de empresa A; admin de empresa B. Roles activos y empresas verificados. |
| Scanner por rol y propietario | Comercial puede crear/leer su sesión general; otra persona de la misma empresa y otra empresa reciben 404. Comercial no puede crear scanner de factura: 403. |
| Data API scanner | Escritura directa, lectura de columnas secretas y lectura anónima rechazadas. Lectura propia de columnas de estado permitida. |
| UI factura y claim móvil | Apertura del diálogo real de nueva factura, creación del scanner y reclamo del PIN mediante la ruta móvil real. |
| Archivo de exactamente 20 MiB | PDF de 20.971.520 bytes, ticket autorizado, subida directa al bucket privado temporal, finalización del scanner y descarga privada desde `invoice-files`. Tamaño y SHA-256 coinciden; archivo aparece en el diálogo. Solicitud de 20 MiB + 1 byte rechazada. |
| Referencias de Storage manipuladas | Bucket ajeno y ruta de otra empresa persistidos solo en la sesión sintética por el cliente privilegiado de pruebas; status devuelve 409 sin URL firmada. Fila restaurada tras cada caso. |
| Aprobaciones fabricadas | Administración no puede insertar una aprobación mediante Data API; admin autenticado no puede invocar directamente la RPC service-only de decisión. |
| Ciclo de aprobación Gmail | REQUESTED → APPROVED por admin legítimo → EXECUTING → FAILED de prueba. Rol de administración y actor de otra empresa rechazados; claim de envío con rol inválido rechazado. Cero llamadas a Gmail y ningún mensaje enviado. |
| Plantilla almacenada | Plantilla sintética con script y handler guardada temporalmente en la empresa QA y renderizada en la ruta real de impresión de un documento existente. Sin ejecución ni elementos activos, CSS A4 conservado. Valor original restaurado en `finally`. |

La primera corrida dio siete PASS y dos fallos dependientes: se usó `127.0.0.1` como Origin, distinto del origen de la solicitud que resuelve el servidor local. La repetición completa sobre `localhost` pasó sin cambiar código ni debilitar la comprobación de origen. Se preservaron ambas evidencias.

El build específico conectado a QA también pasó, incluida la validación TypeScript. La regresión local consolidada previa sigue siendo 274 archivos, 2.496 PASS y 16 omitidos; no se repitió por cambios exclusivamente documentales.

## Limpieza y evidencia

Se eliminaron únicamente los fixtures de las dos corridas: cuatro sesiones scanner, dos tareas y dos aprobaciones; se solicitó la limpieza de los dos objetos sintéticos de Storage (el temporal ya podía haber sido consumido). No se crearon facturas, conexiones Gmail, borradores ni intentos de envío. La plantilla original quedó restaurada. Las migraciones permanecen aplicadas en QA.

Evidencia privada local en `../security-fix-validation` respecto al worktree: `build-qa.log`, `qa-live-initial.json`, `qa-live-results.json`, `qa-cleanup-result.json`, `qa-scanner-completed.png`, `qa-template-print.png` y el harness `qa-live.cjs`. No se publican credenciales, cookies ni URLs firmadas.

## Checks y límites

Revisión de GitHub para el candidato de código d85bfb4:

- `Vercel – control-de-facturas`: success.
- `Vercel – control-scanner-detection-v2`: failure.
- `Vercel – control-facturas-surface-recovery`: failure.
- La consulta de GitHub Actions asociada al SHA y evento pull request no devolvió ejecuciones. No se presenta como una suite CI aprobada.

Los dos checks rojos pertenecen a proyectos expresamente excluidos por el usuario. Se informa su estado; no se investigaron ni cambiaron sus proyectos, configuración o despliegues. El estado agregado no está verde. El check de Vercel no sustituye las pruebas ejecutadas localmente contra QA ni demuestra un nuevo despliegue funcional.

Esta validación no incluye extracción real por IA y guardado final de factura, envío/OAuth real de Gmail, ejecución de un worker desplegado ni certificación visual de todas las plantillas existentes. El claim autorizado completo con conexión/borrador sintéticos y la revocación posterior de rol se cubrieron en PostgreSQL efímero; en QA se ejercitaron la decisión legítima y los rechazos de autoridad descritos arriba. No se presenta como E2E completo de negocio o aprobación de despliegue.

La migración Gmail requiere coordinar una futura actualización compatible de app y worker. Este PR no se mergeó. Producción, autodeploy y los otros proyectos no se modificaron.
