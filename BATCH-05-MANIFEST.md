# Batch 05 manifest

Branch: batch/05-inventory-canonical
Base: 585420964c0332cf75777b5a1b55a8196dc477ab
PR base: main
Preview: xddlzgjwufskgasomval; ledger25 = 20 + 5
Production: READ ONLY; remediation NOT EXECUTED
Focused: 110 PASS; Preview adversarial: 29 PASS
Typecheck: PASS; Webpack build: PASS
Full regression: 1404 PASS / 16 skipped (153 files PASS, 2 skipped); serial --testTimeout=30000. One prior default-5s PGlite initialization timed out during concurrent build; final serial rerun PASS.
No MRP / Need-to-Buy / UI redesign / merge / main push / production writes.

Files: 24

app/(internal)/inventario/page.tsx
app/(internal)/projects/[id]/page.tsx
app/(internal)/projects/progress-forecast-actions.ts
app/api/warehouse-portal/[token]/route.ts
app/warehouse/[token]/warehouse-portal-client.tsx
lib/agent/__tests__/rodrigo-chat.spec.ts
lib/agent/erp-entity-resolver.ts
lib/agent/rodrigo-chat.ts
lib/inventory/__tests__/manual.spec.ts
lib/inventory/__tests__/warehouse-portal.spec.ts
lib/inventory/manual.ts
lib/tools/procurement/get-material-need.ts
lib/tools/stock/get-stock-availability.ts
BATCH-05-MANIFEST.md
IMPLEMENTATION_REPORT-BATCH-05.md
audit-evidence/BATCH-05-INITIAL-STOCK-PAIRS.json
lib/inventory/__tests__/canonical-stock-tool.spec.ts
scripts/batch-05-adversarial.cjs
scripts/batch-05-preview.cjs
supabase/migrations/20261003133414_inventory_canonical_boundaries.sql
supabase/migrations/20261003133854_inventory_opening_identity.sql
supabase/migrations/20261003134723_inventory_confirmed_opening_guard.sql
supabase/migrations/20261003135206_inventory_portal_receipt_atomic.sql
supabase/migrations/20261003135743_inventory_receipt_product_context.sql

