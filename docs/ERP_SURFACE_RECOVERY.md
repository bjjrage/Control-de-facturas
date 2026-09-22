# ERP Surface Recovery

Estado del inventario: 2026-09-22. Esta matriz describe las superficies activas encontradas en el checkout de recuperación, su puerta de entrada y el gate que ya aplica el servidor.

## Root cause

La navegación de proyecto se convirtió en sidebar con `bb6ae17` (`eliminar tabs horizontales del proyecto, sidebar es la navegación`), pero las fuentes de verdad quedaron separadas:

- `app/(internal)/projects/[id]/page.tsx` mantenía `ALL_TABS`.
- `project-tabs-client.tsx` mantenía los branches de render.
- `components/layout/sidebar.tsx` mantenía grupos y labels independientes.

El merge `00d5134` (`merge: integrate skin v3 glass pilot onto current main`) modificó masivamente shell/sidebar y composición visual. La integración de inventario `1ed50cb` agregó Inventario, Recepciones y Pañol al renderer/page, pero el estado de navegación que llegó a este checkout no exponía esas tres entradas. El mismo tipo de regresión dejó `WeeklyPlanSection` montado sólo dentro de Avance físico y sin entrada propia.

El stock por proyecto quedó oculto deliberadamente en `7caa643`: la auditoría determinó que era una lectura legacy sin una acción única, mientras Inventario canónico concentra saldo y consumo. Se conserva el código legacy para compatibilidad, pero ya no es una superficie activa ni una tab válida del contrato.

## Contrato único

`lib/projects/project-features.ts` es el registry canónico. De él se derivan:

- las claves válidas de `?tab=`;
- los grupos y labels del sidebar;
- el plan mínimo y los roles permitidos;
- el filtro de discoverability del sidebar.

Los renderers siguen siendo explícitos en `ProjectTabsClient`; `lib/projects/project-features.test.ts` falla si una entrada del registry no tiene branch de renderer. Esto mantiene el contrato compartido sin cruzar un componente server con un boundary client.

## Feature inventory

| Feature | Código / motor | Ruta / tab | Nav | Plan | Role | Estado antes | Decisión / estado después |
|---|---|---|---|---|---|---|---|
| Presupuesto | `PresupuestoTable`, budget actions | `/projects/:id?tab=presupuesto` | Preparar → Presupuesto | Pro | administración, admin | activo | USER_SURFACE recuperada en registry |
| Cronograma | `ProjectGantt`, Climate Workdays embebido | `?tab=cronograma` | Preparar → Cronograma | Pro | administración, admin | activo | USER_SURFACE |
| Plan semanal / Lookahead | `WeeklyPlanSection`, weekly-plan actions/engine/MRP | `?tab=plan-semanal` | Preparar → Plan semanal | Pro | administración, admin | renderer huérfano / sólo embebido | USER_SURFACE propia; eliminado el duplicado dentro de Avance físico |
| BIM / IFC / visor 3D | `BimSection`, WebIFC/Three.js y `bim-actions` | `?tab=bim` | Preparar → BIM / IFC | Caterpillar | administración, admin | engine visible pobremente; cómputo duplicado | CTA IFC etiquetado, viewer preservado, una sola composición |
| Proveedores de obra | `ProyectoProveedoresTable` | `?tab=proveedores` | Comprar → Proveedores | Pro | administración, admin | activo | USER_SURFACE |
| Cotizaciones / RFQ | `ProyectoRfqsTable`, RFQ actions | `?tab=cotizaciones` | Comprar → Cotizaciones | Pro | administración, admin | activo | USER_SURFACE |
| Órdenes de compra | `ProyectoComprasTable`, orders | `?tab=compras` | Comprar → OC | Pro | administración, admin | activo | USER_SURFACE |
| Facturas proveedor | `ProyectoFacturasTable` | `?tab=facturas` | Comprar → Facturas | Pro | administración, admin | activo | USER_SURFACE |
| Pagos | `ProyectoPagosTable` | `?tab=pagos` | Comprar → Pagos | Pro | administración, admin | activo | USER_SURFACE |
| Ejecución / avances | `EjecucionTable`, execution actions | `?tab=ejecucion` | Ejecutar → Ejecución | Pro | administración, admin | activo | USER_SURFACE |
| Inventario de obra | `InventarioObraSection`, canonical inventory service | `?tab=inventario` | Ejecutar → Inventario | Pro | administración, admin | renderer presente, nav ausente | USER_SURFACE recuperada |
| Recepciones | `RecepcionesObraSection`, canonical movements | `?tab=recepciones` | Ejecutar → Recepciones | Pro | administración, admin | renderer presente, nav ausente | USER_SURFACE recuperada |
| Pañol / rendiciones | `PanolObraSection`, warehouse submissions | `?tab=panol` | Ejecutar → Pañol | Pro | administración, admin | renderer presente, nav ausente | USER_SURFACE recuperada |
| Stock por proyecto legacy | `ProyectoStockSection` | legacy `?tab=stock` | ninguna | — | — | visible en renderer y ALL_TABS | LEGACY_SUPERSEDED; fuera del registry y del sidebar, sin borrar código |
| Personal | `PersonalTable`, labor actions | `?tab=personal` | Ejecutar → Personal | Caterpillar | administración, admin | activo con gate | USER_SURFACE |
| Subcontratistas | `SubcontratistasTable`, contracts/certificates | `?tab=subcontratistas` | Ejecutar → Subcontratistas | Caterpillar | administración, admin | activo con gate | USER_SURFACE |
| Certificados | `CertificadosTable`, certificate tables/actions | `?tab=certificados` | Certificar → Certificados | Caterpillar | administración, admin | activo con gate | USER_SURFACE |
| Avance físico | `AvanceFisicoPanel`, forecast/climate | `?tab=avance-fisico` | Certificar → Avance físico | Caterpillar | administración, admin | activo con gate | USER_SURFACE |
| Informes | `ProjectReports` | `?tab=informes` | Certificar → Informes | Pro | administración, admin | activo | USER_SURFACE |
| Planilla embebida | `PlanillaGrid`, Handsontable + HyperFormula | desde Presupuesto → Generar planilla; `/planillas/:id` | embedded/contextual | Pro | server-side planilla gate | sin tab dedicada | EMBEDDED_SUBFEATURE; no se creó motor ni dominio paralelo |
| Workbook Interpreter | parser, GPT ImportPlan, validator, canonical import | alta de obra → importar planilla | embedded en Nuevo proyecto | Pro | administración, admin | feature presente en rama Workbook | USER_SURFACE contextual; golden protegido por validación determinística |
| Climate Workdays | `ClimateWorkdaysPanel`, climate actions | dentro de Cronograma | embedded | según Cronograma | server-side actions | integrado pero contextual | EMBEDDED_SUBFEATURE, sin módulo paralelo |

## Workspaces globales

| Workspace | Superficies navegables auditadas | Gate principal | Decisión |
|---|---|---|---|
| Administración | Dashboard; Proveedores; RFQ; OC; Facturas proveedor; Pagos; Inventario global; Catálogo de materiales; Tesorería; Flujo de caja; Clientes; Proformas; OT; Remisiones; Facturas de venta; NC; Cobros | roles, módulos Compras/Ventas y plan donde corresponde | `/inventario` se agregó al sidebar; `/stock` se relabeló como catálogo para no aparentar ser inventario canónico |
| Operativo | Dashboard de obras; selector; todas las superficies project-scoped de la matriz | Pro + roles de proyecto; Caterpillar en BIM/Personal/Subcontratistas/Certificar | sidebar de obra derivado del registry |
| Licitaciones | Dashboard; Competidores; Documentos; Auction Bot; Auction Lab; detalle/radar | Pro + roles definidos en sidebar | preservado fuera del scope conversacional de Rodrigo |

Rutas contextuales (`/configuracion`, `/users`, `/empresas`, actividad de agente, detalles y formularios) permanecen detrás de sus entradas administrativas o de sus flujos padre; no se agregaron botones duplicados al workspace equivocado.

## Gating

La página de obra sigue protegida por `requirePlan("pro", ["administracion", "admin"])`. El registry aplica además el gate Caterpillar para BIM, Personal, Subcontratistas, Certificados y Avance físico. Un deep route a una tab no autorizada vuelve a Presupuesto; no queda un panel vacío por una tab gated. Las acciones server-side existentes siguen siendo la autoridad y no se relajaron.

## Workbook recovery

`validateImportPlan` ahora ejecuta una reconciliación local acotada:

1. valida rangos y provenance;
2. excluye filas que se identifican determinísticamente como total/subtotal;
3. recupera un bloque BUDGET o CERTIFICATE omitido sólo cuando encabezados y rangos locales lo sostienen;
4. cruza certificado ↔ presupuesto 1:1 por código, descripción y unidad;
5. usa cantidades contractuales del certificado sólo cuando todas sus líneas hacen match;
6. deja MEDICIÓN como `DETECTED_NOT_APPLIED` cuando la identidad o el hecho fechado no es seguro.

No se usa filename, rango fijo, cache compartido ni hardcode del golden.

## Estado de orphaning

Superficies activas orientadas a usuario encontradas: 18 project-scoped + las globales de los tres workspaces. USER_SURFACE orphaned conocidas: 0 después de este cambio. Stock por proyecto se reporta explícitamente como `LEGACY_SUPERSEDED`, no como orphan.

## Evidencia y próximos resultados

Los resultados ejecutables y el SHA de certificación final se registran en [ERP_SURFACE_CERTIFICATION.md](ERP_SURFACE_CERTIFICATION.md). Este documento no implica merge a `main` ni deployment de producción.
