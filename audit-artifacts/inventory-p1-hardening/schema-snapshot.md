# Read-only schema snapshot

Project: `mjbvxyvpojnpyrkiyujk`

## Branch metadata

```json
{
  "name": "inventory-p1-hardening",
  "project_ref": "mjbvxyvpojnpyrkiyujk",
  "branch_id": "b5f68fd2-02ab-4f62-8e30-41edbdde4006",
  "status": "MIGRATIONS_FAILED",
  "preview_project_status": "ACTIVE_HEALTHY",
  "created_at": "2026-09-14T02:53:57.458807+00:00",
  "updated_at": "2026-09-14T02:53:57.458807+00:00",
  "parent_project_ref": "ezucivipgmbvamhugkbj"
}
```

## Catalog consistency

The read-only catalog audit returned empty missing lists for all expected inventory objects:

- expected tables missing: `0`
- expected columns missing: `0`
- expected constraints missing: `0`
- expected indexes missing: `0`
- expected triggers missing: `0`
- expected functions missing: `0`
- expected views missing: `0`
- invalid expected indexes: `0`
- unvalidated expected inventory constraints: `0`

All expected inventory, OC and warehouse tables had `relrowsecurity = true`. The expected immutable movement and confirmed-submission triggers were enabled (`tgenabled = O`).

## P1 objects observed

- `idx_oc_recepcion_items_order_item_once`
- `trg_prevent_confirmed_warehouse_submission_line_mutation`
- `trg_prevent_confirmed_warehouse_submission_evidence_mutation`
- `trg_inventory_movements_immutable`
- `public.can_read_warehouse_evidence(text)`
- `public.upsert_inventory_balance(...)`
- `public.inventory_post_movement(...)`
- `public.inventory_confirm_receipt(...)`
- `public.inventory_confirm_warehouse_submission(...)`
- `inventory_stock_by_location`
- `inventory_stock_global`
- `inventory_stock_global_quantity`
- `inventory_stock_by_project`
- `inventory_consumption_by_budget`

All five SECURITY DEFINER inventory functions reported `proconfig = {"search_path=\"\""}`. The current `inventory_post_movement` definition contains the transfer metadata selection (`original_cost_currency`, `original_unit_cost`), fail-closed FX handling and locking. The storage policy was:

```text
policy: internal read warehouse evidence
table: storage.objects
command: SELECT
roles: {authenticated}
qual: (bucket_id = 'warehouse-evidence' AND can_read_warehouse_evidence(name))
```

The cost-bearing views contain the computable-cost filter. The quantity-only view intentionally does not filter cost status.

## Runtime consistency

- active migration queries after excluding the diagnostic session: `0`
- prepared transactions: `0`
- index builds in progress: `0`
- invalid indexes: `0`

One unvalidated constraint existed globally, but it is unrelated to inventory:

```text
realtime.messages.messages_payload_exclusive
CHECK ((payload IS NULL) OR (binary_payload IS NULL)) NOT VALID
```

This is pre-existing Realtime infrastructure, not a partial inventory migration object.
