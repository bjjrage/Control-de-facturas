# Legacy ERP surface contract audit

## Scope and authority

- Legacy surface authority: `cb0d83d9f1fe433ce0cbb8ae2d4c182abbe7866f`.
- Recovery/module authority: `77886af26381c3176aba3386b5ac006572b6f30b`.
- Audit describes the recovery tree **before** this restoration work.
- `SAME`, `RENAMED`, `HIDDEN`, `REPLACED`, `LOST`, and `NEW ADDITIVE` describe user-visible access, not whether backend code exists.

## Global surfaces

| Surface | Old ERP (`cb0d83d`) | Recovery (`77886af`) | Status / evidence |
|---|---|---|---|
| Dashboard | Historical operational cards plus recent RFQs | Executive dashboard with new finance, works, and bid KPIs | REPLACED — old 11 conditional metric cards and “Solicitudes recientes” section absent |
| Proyectos | Direct left-sidebar link | Workspace switcher destination only; switcher hidden below `md` | HIDDEN |
| Proveedores | Direct Comprar link | Same route and role/module gate | SAME |
| Cotizaciones | Direct Comprar link | Same route and role/module gate | SAME |
| Órdenes de compra | Direct Comprar link | Same route and role/module gate | SAME |
| Facturas | Direct Comprar link | Same route and role/module gate | SAME |
| Pagos | Direct Comprar link | Same route and role/module gate | SAME |
| Stock | Direct Comprar link | Same legacy route remains | SAME |
| Clientes | Direct Vender link | Same route and module gate | SAME |
| Proformas | Direct Vender link | Same route and module gate | SAME |
| Órdenes de trabajo | Absent from legacy contract | Added to Vender | NEW ADDITIVE |
| Remisiones | Direct Vender link | Same route and module gate | SAME |
| Facturas de venta | Direct Vender link | Same route and module gate | SAME |
| Notas de crédito | Direct Vender link | Same route and module gate | SAME |
| Cobros | Direct Vender link | Same route and module gate | SAME |
| Tesorería | Direct Finanzas link | Same route | SAME |
| Flujo de caja | Direct Finanzas link | Same route | SAME |
| Licitaciones | Direct left-sidebar link | Workspace switcher destination only; switcher hidden below `md` | HIDDEN |
| Configuración | Right rail titled “Configuración” | Same route/actions in right rail titled “Cuenta” | RENAMED |
| Usuarios | Right configuration rail | Same configuration link and admin gate | SAME |
| Empresas | Right configuration rail for super admins | Same configuration link and super-admin gate | SAME |

## Project surfaces

| Surface | Old ERP | Recovery | Status / evidence |
|---|---|---|---|
| Presupuesto | Project-folder tab; create/edit items and table actions | Same tab/actions, plus planilla generation | SAME |
| Import Excel | Budget spreadsheet import dialog | Same budget import plus Workbook Interpreter in project creation | SAME + NEW ADDITIVE |
| Cronograma | Gantt tab | Gantt plus climate workday panel | SAME + NEW ADDITIVE |
| Proveedores | Project-folder tab, add/remove dialogs and table | Same | SAME |
| Cotizaciones | Project-folder tab, new-RFQ dialog and table | Same | SAME |
| OC | Project-folder tab, new-order dialog and table | Same | SAME |
| Facturas | Project-folder tab and invoice table | Same | SAME |
| Pagos | Project-folder tab and payment table | Same | SAME |
| Ejecución | Entry form, execution link dialog, table/photos | Same | SAME |
| Stock / Materiales | Project-folder tab | Same legacy stock surface; canonical inventory added separately | SAME + NEW ADDITIVE |
| Personal | Caterpillar-only tab, entry form and table | Same | SAME |
| Subcontratistas | Caterpillar-only tab, contract/certificate actions | Same | SAME |
| Certificados | Certificate actions/table and paste-from-Excel progress dialog | Same | SAME; no direct workbook upload found (see audit below) |
| Avance físico | Progress Forecast, financial curve, workday ledger | Weekly Plan replaced the Progress Forecast component; curve and ledger remain | REPLACED — restore Progress Forecast alongside Weekly Plan |
| Informes | Reports tab with charts and exports | Same | SAME |
| Inventario | Not in old contract | Canonical project-inventory component rendered for `tab=inventario`, but no project-folder nav item | HIDDEN (new additive) |
| Recepciones | Not in old contract | Component rendered for `tab=recepciones`, but no project-folder nav item | HIDDEN (new additive) |
| Pañol | Not in old contract | Component rendered for `tab=panol`, but no project-folder nav item | HIDDEN (new additive) |

The old project-folder groups and all old tabs remain in `components/layout/sidebar.tsx`. Comparison of the old/current project page and tab renderer found no other removed legacy form, dialog, link, or table entry point; the displaced Progress Forecast component is the exception above. The `window.history.pushState` tab navigation is retained.

## Later modules and their recovery entry points

| Module | Current recovery entry point | Baseline status |
|---|---|---|
| BIM | Project-folder BIM tab | SAME / preserved |
| Cómputo | Project-folder BIM tab, below BIM | NEW ADDITIVE / reachable |
| Planillas | Presupuesto tab “Generar planilla” action | NEW ADDITIVE / reachable |
| Weekly Plan / MRP | Avance físico tab | NEW ADDITIVE / reachable, but displaced Progress Forecast |
| Climate | Cronograma tab | NEW ADDITIVE / reachable |
| Scanner | Invoice scan flow and scanner route | NEW ADDITIVE / reachable |
| Auction Bot / Auction Lab | Links in Licitaciones | NEW ADDITIVE / reachable, dependent on restoring direct Licitaciones navigation |
| Rodrigo / Agent Eyes | Global widget; activity link from widget | NEW ADDITIVE / reachable |
| Workbook Interpreter | New Project dialog | NEW ADDITIVE / reachable from Proyectos |
| Canonical Inventory (global) | `/inventario` exists; no global sidebar entry | HIDDEN (new additive) |
| Acceptance / OT | `/ordenes-trabajo` link in Vender | NEW ADDITIVE / reachable |

## Certificate workbook history

Search scope: all local and remote refs, commit history/reflog, and registered worktrees; searched certificate UI, project UI, Excel/workbook terms, file inputs and `.xlsx`/`.xls`/`.csv` acceptance. No direct full-workbook certificate importer was found. The historical feature at `6e9ff95187a7f9233436f7c336fe24ec341ee43d` (“certificados — pegar avance del mes desde Excel”) is a clipboard paste dialog for already-aligned monthly progress values, not a workbook uploader. In the current Workbook Interpreter UI, certificate accumulations and amounts are explicitly recalculated from `project_certificate_items`, not imported as authoritative workbook data.

**DIRECT CERTIFICATE WORKBOOK IMPORT NOT FOUND**

## Missing legacy action count before restoration

Counted by user-facing entry point group, not individual data rows: 2 missing global links (Proyectos, Licitaciones) + 11 conditional legacy dashboard cards + 1 recent-RFQ section + 1 displaced Progress Forecast panel = **15**. The 11 dashboard cards are: two RFQ, three invoice, two sales, and four conditional cards (credit note, low stock, expiring documents, and upcoming tenders). New inventory tabs/global entry are separately identified as hidden new features, not counted as old actions.
