# Resultado SEC04 — plantillas de facturas

**Base auditada:** `798985d355fb8ed96796237e6f198c172db98709`
**Rama de corrección:** `batch/security-main-798985d`
**Resultado:** corrección implementada en este worktree; no se aplicó a producción.

## Riesgo y ruta antes del cambio

La auditoría consolidada clasificó SEC04 como **alta potencial, condicionado al ingreso de HTML no confiable en el flujo de plantillas**. Confirmó ejecución del renderizador mediante una prueba sintética; no demostró una imagen que engañara al modelo. Un administrador autenticado podía recibir HTML generado para una plantilla, verlo en una previsualización `srcDoc` sin sandbox y guardar HTML sin sanear. Después, la ruta de impresión lo insertaba como HTML. Una respuesta de generación manipulada con elementos activos podía ejecutar JavaScript en el origen de la aplicación al abrir la previsualización; al guardar, podía persistir para la ruta de impresión. La ruta exige privilegios administrativos; el hallazgo no demuestra acceso entre empresas.

## Remediación

- `lib/template-sanitizer.ts` aplica una allowlist HTML cerrada en servidor con `sanitize-html` y parsea estructura HTML con `htmlparser2`. Elimina scripts, manejadores, SVG/MathML, iframes, formularios, elementos embebidos y recursos externos arbitrarios. Limita HTML a 128 KiB, CSS a 32 KiB, nodos CSS a 4 KiB y nesting a 32. La interpolación de valores de factura se hace mediante nodos/serialización HTML, escapando texto y atributos; los ítems de tabla usan un marcador aleatorio en una sustitución de una sola pasada.
- El CSS de `<style>` se parsea con PostCSS y `map: false`; no se resuelven mapas ni rutas. Se reconstruye únicamente CSS permitido: selectores simples confinados al wrapper `[data-company-template]`, declaraciones de presentación de allowlist, `@page` con tamaño A4/A5/Letter/Legal y márgenes, y `@media print|screen|all`. Se descartan `@import`, fuentes remotas, URLs/recursos, funciones CSS, escapes, propiedades personalizadas, comentarios, at-rules desconocidas y combinadores que escaparían del wrapper. El estilo inline pasa por el parser y allowlist de `sanitize-html`.
- Se conservan las reglas A4 y las reglas sencillas de impresión/diseño. CSS complejo, selectores avanzados y recursos externos se eliminan intencionalmente, por lo que plantillas que dependan de ellos pueden perder formato. Solo el logo se sustituye al renderizar si su URL coincide con el origen Supabase configurado y la ruta exacta de branding autorizada; no se aceptan credenciales, query/hash ni otros orígenes.
- `generateTemplate`, `saveTemplate` y el renderer saneado en `lib/template.ts` hacen cumplir la misma política; el renderer vuelve a sanear plantillas ya persistidas. La acción de guardado valida también tipo documental, tamaño y el guard de administrador/empresa existente.
- El editor usa preview devuelto por el servidor y el iframe lleva `sandbox=""`, `referrerPolicy="no-referrer"` y CSP que bloquea scripts, conexiones, frames, formularios y recursos externos. No concede `allow-scripts` ni `allow-same-origin`.

## Dependencias

Se usan dependencias directas declaradas por el propietario de la rama: `sanitize-html` 2.18.1 y `@types/sanitize-html` 2.16.2 para la allowlist HTML; `htmlparser2` 12.0.0 para parsear e interpolar HTML; y `postcss` 8.5.31 para analizar/reconstruir CSS no confiable. No se implementó un parser/sanitizador CSS basado solo en regex. `map: false` se pasa expresamente a PostCSS para evitar que comentarios `sourceMappingURL` provoquen carga o resolución de mapas.

## Validación

- `npx vitest run lib/template-sanitizer.test.ts`: **7/7 PASS**. Incluye A4/media, HTML activo y recursos externos, CSS peligroso, comentarios `sourceMappingURL` sin resolver mapas, idempotencia, escape de selectores hermanos, sustitución de una pasada, escape de valores de factura y validación de URL de logo.
- ESLint de los seis archivos modificados del scope: **PASS**.
- El propietario de la rama informó que la prueba browser offline de `renderTemplate`/`renderTemplatePreview` pasó: cero ejecución de JavaScript/nodos activos/solicitudes de red, aislamiento del `srcDoc` mediante sandbox y conservación de A4. Evidencia comunicada en `../security-fix-validation/template-browser-proof.*`; no se ejecutaron proveedores ni sesiones reales.
- El resultado de Vitest global/build no se atribuye a esta corrección; sigue siendo responsabilidad de la validación de integración de la rama.

## Cobertura y límites

Este resultado cubre el flujo SEC04 de plantillas, vista previa, guardado, sustitución de datos y renderizado de impresión. No cubre endpoints, portales por token, scanner/QR, cargas/descargas ni el resto de hallazgos de la auditoría. Las pruebas son offline y no usan credenciales, datos cloud ni servicios externos. Los cambios se hicieron solo en el worktree de esta rama y este informe; no se hizo commit, push ni despliegue.
