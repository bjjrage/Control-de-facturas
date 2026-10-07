# QA ADMIN REMEDIATION 1 — 2026-10-07

## Base y alcance

- Branch: `fix/qa-admin-remediation-1`.
- HEAD de desarrollo inicial y release QA: `0b9f76796613fee437fa85b790937284b487febe`.
- El checkout local estaba en `main` / `5b1e1d638a6fc517dd464c3bec6643dbb03634cc`; se creó la branch desde el release vigente en `origin/main`. No se revirtió `main`.
- `origin/main` volvió a verificarse en `0b9f767...` antes de entregar.
- Fuente: `QA_Administracion_Reporte_Completo_2026-10-07.zip`, `report.md`, `bugs.md`, `results.csv`, Master y fixtures originales. La corrida cerrada mantiene **21 PASS / 7 FAIL / 33 BLOQUEADO**. La abortada por setup mantiene **2 PASS / 59 BLOQUEADO**. No se ejecutó nuevamente el checklist de 61 pasos.
- HEAD final y resultado del push se consignan en el reporte de entrega, fuera del propio commit.

## BUG-004 — lector PDF en backend

### Causa y recorrido

`RfqWorkspace / QuoteReview` → `extractQuoteDocumentAction` → `readDocumentContent` → `extractPdfText` → import dinámico de `pdf-parse@2.4.5` → PDF.js legacy.

La extracción ocurre en **Server Action / Node**, no en el navegador ni en Edge. PDF.js intenta cargar `@napi-rs/canvas` usando `createRequire(import.meta.url)` y construir `DOMMatrix`; además carga un worker mediante una ruta relativa a su módulo. El bundling del paquete modifica ese contexto. El trazado estático también omite assets cargados dinámicamente.

El error `DOMMatrix is not defined` pertenece a la evidencia original de Producción. En Windows, con canvas instalado, la configuración anterior falla más tarde por un worker resuelto dentro de `.next/server/chunks`. No se afirma haber reproducido exactamente el mismo error de DOMMatrix en Windows.

### Corrección mínima

- `next.config.ts`: `serverExternalPackages: ["pdf-parse"]`, para conservar el entrypoint nativo de Node.
- Includes de tracing acotados a `/rfqs/*` y `/api/agent/chat`: módulos PDF, workers, recursos de PDF.js y bindings canvas instalados para la plataforma.
- `lib/documents/reader.ts`: liberación del parser en `finally` mediante `destroy()`; función exportada para probar el extractor real.
- Sin DOM simulado, jsdom, cambios de dependencias ni relajación de revisión humana.

### Evidencia

- Los dos PDFs originales se extraen realmente; precios Cementos **68.000 / 1.550**, Ferretería **72.000 / 1.400**. No OCR inventado, parser mock ni modificación de PDFs.
- Regresión con compilador Next/Turbopack y HTTP real: configuración anterior → ambos HTTP 500 por worker; configuración corregida → ambos HTTP 200 y texto completo.
- Trace del build de prueba: **worker presente / binding nativo presente**.
- Smoke sobre build completo Next/webpack, app real y branch Supabase: creación normal de RFQ, invitaciones, versiones con PDFs, extracción, transcripción, resolución humana, dos reviews, comparación y propuesta editable. **0 OC**. No se guardó autorización ni adjudicación.
- Impuesto y flete no constan en los PDFs; se preservó su ausencia documental y se justificó explícitamente la diferencia con los valores 0 de la oferta sintética. No se inventaron como hechos del PDF.
- `eligibleLine`, `validateAllocation`, RPC de review y generación de OC permanecen intactos.

## BUG-001 — listas después de guardar

La implementación anterior usaba `revalidatePath` y `router.refresh()`. Proveedores también tiene una sección keep-alive de AppShell: sus snapshots se recargaban al cambiar `pathname`, pero no al recibir nuevos children RSC en la misma ruta. `ProvidersSection` ya sincronizaba su estado cuando recibía datos nuevos; faltaba actualizar el snapshot que la alimentaba.

`refreshAfterSave` comparte `revalidatePath` + `refresh()` de Next, exclusivamente en Server Actions después de escrituras exitosas. AppShell recarga su snapshot cuando cambia `children`, aunque la ruta sea igual. Se quitaron los refresh redundantes de los diálogos afectados. Errores y cierres de modal conservan el flujo existente.

Superficies observadas por UI real, sin F5 después de guardar:

| Superficie | Resultado |
| --- | --- |
| Proveedores | Dos altas visibles; una fila por proveedor |
| Obra | Alta visible inmediatamente |
| Presupuesto | Seis partidas visibles después de una importación |
| Certificado | Una fila BORRADOR, 53.000.000 PYG |

Los tests del helper usan el contexto real de Next; los tests de conexión por archivo no sustituyen los smokes de navegador.

## BUG-003 — unidades manuales

El importador ya conserva las unidades del fixture. La lista compartida manual estaba incompleta. Se agregaron `un`, `barra`, `balde`, `L` a compra y `L`, `un` a base, manteniendo `unidad` y `lt`; no se normalizaron ni migraron datos existentes. Alta y edición siguen usando la misma fuente `lib/stock-units.ts`. No se restringió el importador de texto libre.

Catálogo final compra: unidad, un, barra, balde, par, bolsa, saco, caja, paquete, rollo, pallet, tambor, bidón, kg, g, tonelada, lt, L, ml, m, m², m³.

Catálogo final base: kg, g, tonelada, lt, L, ml, m, m², m³, unidad, un.

Smoke manual de los seis materiales originales: cemento bolsa/50 kg; ladrillo un; arena m³; hierro barra/12 m; cable m; pintura balde/20 L. Lectura de persistencia confirma las unidades exactas; sin saldo inicial ni movimiento ficticio de stock.

## BUG-002 — REQUIRES PRODUCT DECISION

Inspección READ-ONLY: `providers` tiene id, name, contact_name, email, phone, active, tax_id, created_at, empresa_id. No tiene condición/plazo maestro de pago. `payment_terms` existe en ofertas/versiones RFQ; la factura tiene su propio vencimiento.

No se agregó campo, migración ni regla contable. Propuesta mínima para decisión futura: plazo opcional del proveedor como sugerencia para documentos nuevos; precedencia explícita factura > oferta > sugerencia del proveedor; preservar documentos y vencimientos existentes. Requiere acordar alcance, semántica y migración antes de implementar.

## Preparación de escenario

### Ventas y provisioning

No se encontró UI normal que cambie `modulo_ventas`; editar plan no equivale a habilitar el módulo. El tenant QA de Producción **no fue alterado**.

Existe provisioning de entornos E2E en `scripts/e2e/seed-canonical-demo.ts`, con tenant y usuario nuevos y módulos explícitos. Se reutilizó ese contrato de provisioning en un helper acotado a la nueva branch autorizada. La empresa nueva se inicializó con Compras/Ventas habilitadas, caterpillar y RUC 80099999-1. Usuario nuevo **admin / is_super_admin=false**. No se elevó ni modificó una identidad existente.

Para la próxima certificación en este entorno aislado hay identidad/tenant provisionados. Habilitar Ventas al tenant existente de Producción sigue requiriendo el procedimiento del propietario; no se inventó un botón ni se ejecutó SQL correctivo.

### BOM

El producto espera `budget_item_materials`: partida, producto, material por unidad ejecutada, desperdicio. El requisito REQUIRES_BOM permanece vigente.

`test/fixtures/qa-admin/bom-mamposteria.json` y el generador producen XLSX para importar por Presupuesto → APU → Materiales de partida 03. Ratios explícitamente sintéticos QA: cemento 0,25 bolsa/m²; ladrillo 40 un/m²; arena 0,02 m³/m²; desperdicio 0 %.

Meta 100 m² / clima OFF / stock de obra 0 / central libre 100 bolsas, 2.000 un, 5 m³ / sin OC: bruto **25 bolsas / 4.000 un / 2 m³**, compra neta **0 / 2.000 / 0**, caja adicional **2.800.000 PYG**. Se probaron el engine y la cobertura reales. La RFQ manual 60/3.000 sigue como alternativa del Master; no se afirma que derive de este BOM ni que sea una receta técnica de obra.

### Clima, cámara y meteorología

`node test-utils/qa-admin-fixtures.mjs YYYY-MM-DD` genera una variante local sin red ni DB. Para 2026-10-07: LL 2026-10-04, HH 2026-10-05, B 2026-10-06; corte 2026-10-06. Antes del siguiente test se regenera y verifica el rango contractual y el corte histórico del ERP. No se permiten fechas futuras.

Medición local sintética 35 mm; umbral GT 20 mm; eligible LL/HH; tolerancia mensual completa 2 días; resultado esperado 0 de extensión. Requiere evidencia y causalidad; residente aporta evidencia/propuesta, admin confirma y crea el efecto HH manteniendo vínculo causal. No se emite prórroga oficial ni se modifica el motor PBC.

Punto exclusivamente QA declarado: Asunción (-25.3, -57.6), no ubicación de una obra real. Una observación externa distinta no debe cambiarse ni describirse falsamente como 35 mm.

`CapturaVerificada` usa cámara. Si realmente falla su apertura, el fallback existente «Subir foto» admite archivo y registra `source=archivo`; no se añadió control ni se forzó el fallo. Fotografiar soporte sintético QA con cámara es el procedimiento principal, nunca presentarlo como observación meteorológica real.

## Certificado 0 PYG — EXPECTED / FIXTURE INCOMPLETE

El PDF en `app/api/projects/[id]/certificado/[certId]/pdf/route.tsx` lee `project.contract_amount`. `budget_total` representa presupuesto estimado. En la obra de la corrida cerrada, la lectura READ-ONLY confirmó budget_total 500.000.000, contract_amount 0 y contract_number null. No había contrato formal cargado. Se mantiene la separación; no se reemplazó el monto contractual por el presupuesto.

## Entorno y evidencias

- Supabase branch autorizada: `qa-admin-remediation-1`, ref `voxiddrfhfanbyatpcvb`, Credimatch; 55 migraciones existentes, sin datos de Producción copiados.
- Coste de branch informado y autorizado: US$ 0,01344/h (~US$ 0,32/día). La branch queda disponible para la siguiente certificación; no se eliminó el entorno ni sus evidencias.
- Empresa QA: `8bcfab3f-44cd-4bfb-973d-82521b3e69f9`.
- Usuario QA admin: `04e755fb-f9aa-40b2-9bbd-fa8a4d0e7b7d`.
- Smokes: build local compilado / branch aislada; no cambios de env en Vercel ni deploy de Producción.
- Evidencias bajo `qa-e2e-administracion/remediation-1`, separadas de las dos corridas QA anteriores. Credenciales privadas quedan fuera del repo y del ZIP de reporte.
- Intentos de harness se preservaron: arranque dev/origin, lectura SheetJS ESM, nombre incorrecto de tabla del verificador y selector de texto. La repetición del import en un fixture ya poblado duplicó sus partidas; no se mezcló con el resultado final. Se creó por UI una obra limpia, importó una vez y eliminó por UI exclusivamente el fixture supersedido de esta branch. Se mantuvieron las evidencias. No se borró ningún dato de la corrida original.

## Calidad y límite de cierre

- Typecheck completo: PASS.
- Suite completa: 1.901 PASS / 16 SKIPPED en una ejecución finalizada; límites de tiempo y workers de las repeticiones se registran en logs.
- Tests focalizados: 25 PASS, parser y engines reales.
- Build completo de Producción Next 16.3.8/webpack: PASS, incluida la repetición final. Los traces de `/rfqs/[id]` y `/api/agent/chat` incluyen cada uno seis archivos worker y un binding canvas nativo. Resultado de suite repetida consignado en reporte de entrega.
- Regresión compilada Next/Turbopack antes/después: PASS; trace incluye worker y canvas nativo.
- Smokes RFQ, cuatro superficies y seis unidades: PASS.
- Diff check: PASS al revisar cambios.
- **Lint completo: FAIL preexistente, 699 errores / 312 advertencias.** Ejecución sobre el SHA base produce las mismas 1.011 incidencias por archivo/regla/mensaje; comparación normalizada sin incidencias nuevas. Lint focalizado de correcciones/nuevos archivos no introduce errores.
- No se hizo una limpieza general fuera del alcance ni se desactivó ESLint para declarar PASS. **El criterio global DONE no se cumple mientras el lint completo sea FAIL.**

Las validaciones usan copia de los archivos versionados y del delta, fuera de los ~55 worktrees antiguos que estaban siendo incluidos por los globs globales. Dependencias instaladas corresponden al lockfile (Next 16.3.8). La copia ajusta solamente `outputFileTracingRoot` al ancestro común de su junction de node_modules; ese path de máquina no se incorpora a configuración de la aplicación.

## Cambios incluidos

Código: next.config.ts; lib/documents/reader.ts; lib/stock-units.ts; lib/refresh-after-save.ts; components/layout/app-shell-client.tsx; providers/actions.ts; projects/actions.ts; projects/certificado-actions.ts; projects/new-project-dialog.tsx; projects/[id]/import-budget-dialog.tsx; projects/[id]/import-certificado-dialog.tsx.

Tests/fixtures: test/qa-admin-pdf.test.ts; test/qa-admin-refresh.test.ts; test/qa-admin-fixtures.test.ts; test/fixtures/qa-admin/{dos PDFs originales,bom-mamposteria.json}; test-utils/qa-admin-{pdf-runtime,fixtures,provision,smoke}.mjs; este reporte.

Sin cambios en package.json/lockfile, migraciones, permisos, RLS, reglas RFQ, motores PBC o inventario. Archivos locales preexistentes fuera del batch no se agregan al commit.

PRODUCTION MODIFIED: NO

PRODUCTION DB MANUALLY MODIFIED: NO

MAIN MERGED: NO

PRODUCTION DEPLOYED: NO

SIFEN USED: NO
