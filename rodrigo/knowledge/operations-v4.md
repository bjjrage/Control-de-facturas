# Rodrigo ERP Knowledge V4 — auditoría operativa

Este documento enumera únicamente superficies encontradas en código, migraciones o servicios existentes. No agrega una capacidad por la mera existencia de una pantalla.

## Patrón de ejecución

- Las lecturas V4 son riesgo 0 y validan el tenant antes de consultar.
- Las mutaciones nuevas son riesgo 2 y pasan por `gatewayExecute`/approval antes de llamar la server action real.
- Las respuestas de scanner y Auction Lab excluyen credenciales, hashes, PINes, tokens, `random_close_at` y filesystem arbitrario.
- Tesorería sigue siendo lectura: no hay herramientas de pagos, cobros, transferencias, conciliaciones ni liquidaciones.
- No se crearon skills, migraciones ni un tool transversal hardcodeado.

## Tools agregadas

| Tool | Nivel | Fuente real |
| --- | ---: | --- |
| `get_labor_subcontractor_overview` | 0 | `daily_labor_entries`, `subcontractors`, `subcontractor_contracts`, `subcontractor_certificates`, `project_certificate_staff`. |
| `manage_labor_subcontractor` | 2 | `app/(internal)/projects/caterpillar-actions.ts`. |
| `get_apu_overview` | 0 | `budget_items`, `budget_item_materials`, `productos`. |
| `manage_apu_material` | 2 | `saveBudgetItemMaterialAction`. |
| `get_scanner_session_overview` | 0 | `scan_sessions`, con campos sensibles excluidos. |
| `get_auction_overview` | 0 | `loadSandboxBundle` + `buildWatchView` de Auction Lab. |
| `manage_auction_lab` | 2 | `startSandboxRoom`, `setSandboxBotPaused`, `authorizeAssistedBid`, `declineLimitBreachBid`, `finalizeSandboxRoom`. |
| `get_project_operational_overview` | 0 | avance, plan semanal, certificados y `climate_*`. |
| `get_inventory_overview` | 0 | `lib/inventory/service.ts` + tablas/vistas `inventory_*`. |
| `get_billing_overview` | 0 | `sales_documents`, `sales_document_items`, `work_orders`, `clients`. |

## Lo que sigue faltando

- No existe un APU estructurado de mano de obra/equipos/rendimientos.
- No existe presentación formal de ofertas DNCP desde Rodrigo.
- Auction Lab se puede leer y operar en acciones acotadas (iniciar, pausar/reanudar, postura asistida, ceder y finalizar) con aprobación; configurar policy nueva, crear sala y operar modo automático siguen fuera.
- Scanner/adjuntos se pueden consultar cuando ya existen; la conversación no carga ni asocia binarios.
- El reporting transversal emerge de múltiples lecturas; no se persiste un informe gigante.
