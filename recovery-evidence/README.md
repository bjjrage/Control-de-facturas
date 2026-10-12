# Evidencia mínima del recovery local

Código testigo `a61c655`, BASE `953ebba`; implementación y SHA final en `../RECOVERY_CHECKPOINT.json`.

Logs seleccionados normalizados a UTF-8 y sin espacios finales/líneas vacías de cierre para facilitar el diff; mensajes, resultados y conteos conservados.

- `base-browser/results.json`: pérdida de campos reproducida al devolver un error sintético desde acciones de componentes BASE. No identifica el error original del servidor de Marcelo.
- `recovery-browser/results.json`: componentes reales, Chromium/Firefox, 1440×1000/390×844. Conservación de campos/archivo, segunda apertura y análisis automático XLSX en workspace. Hechos extraídos no precargados ni rellenados por el test. Propuestas preliminares presentes; revisión humana requerida.
- Las seis capturas seleccionadas usan CSS mínimo del harness: muestran estado, no equivalencia visual del ERP. Más capturas/logs de ejecución quedan ignorados localmente para no versionar un expediente masivo.
- `automatic-analysis.spec.ts` en `lib/rfq/__tests__`: acción pública y cadena real de lectura/contraste con original XLSX representativo. DB, Storage y RPC simulados. No es E2E persistente.
- `unit-suite.log`, `typecheck.log`, `build-final.log`: verificaciones finales. La suite excluye explícitamente pruebas live/DB externas según `vitest.config.mts`; sus PASS no acreditan esas integraciones.
- `base-lint.log` y `changed-lint.log`: comparación de fallos preexistentes y revisión de archivos cambiados. El listado `rfqs-section.tsx` conserva un fallo preexistente fuera de los cambios; no se oculta bajo un PASS global de lint.
- `document-history.txt`: historial sobre todas las refs Git disponibles de las funciones de análisis y del lector. Aprobación comercial proviene de la corrección explícita del propietario, no de los reportes de implementación.

No se levantó la app contra un remoto, no se copiaron credenciales y no hubo transporte externo/SIFEN/modelos pagos. E2E real de portal proveedor y de cliente/OT/stock/factura/pagos sigue BLOCKED por falta de stack local compatible activo. La CLI de Supabase existe; `status` falló en sandbox al escribir telemetría antes de comprobar el stack. No equivale a probar que una integración pasó ni que esa capacidad aprobada nunca existió.
