# Real DEV Supabase smoke results A–K

All tests ran against `mjbvxyvpojnpyrkiyujk`, not an in-memory database. All passed.

| Test | Result | Evidence preserved |
|---|---|---|
| A. Storage cross-tenant | PASS | service_role saw 4 fixture objects; tenant A saw its 2 canonical objects; tenant A saw tenant B path `0`; orphan path `0`; anon list `0`. |
| B. Receipt cumulative limit | PASS | 6/10 confirmed; later 5/10 rejected before movement creation. Duplicate `order_item_id` rejected by unique guard. |
| C. Receipt concurrency | PASS | Two concurrent confirmations of 3 against remaining 4: one `CONFIRMED` with one movement, one remained `DRAFT` with zero movements; total confirmed `9/10`. |
| D. Receipt idempotency | PASS | Retry with the same key returned the existing movement; count remained `1`. |
| E. FX receipt fail-closed | PASS | PYG computable at FX 1; USD with FX 7500 computable; USD without FX `REVISION_REQUERIDA`; unknown legacy cost `REVISION_REQUERIDA`; non-computable stock absent from the PYG aggregate. |
| F. Transfer cost propagation | PASS | USD layer preserved currency/nominal cost/FX; company total `750000`. |
| G. Consumption cost propagation | PASS | Canonical USD layer preserved; company total `300000`. |
| H. Return cost propagation | PASS | Origin cost preserved; company total `150000`. |
| I. Confirmed-submission immutability | PASS | With service_role, line UPDATE/DELETE/INSERT and evidence UPDATE/DELETE/INSERT were all rejected by DB triggers. |
| J. Tenant/project/budget/OC isolation | PASS | Cross-tenant OC, cross-tenant location, cross-tenant project and invalid/cross-tenant budget attempts all rejected before insertion. |
| K. Reversal/correction event | PASS | Existing RETURN path created a new immutable movement event; the original confirmed movement was not updated or deleted. |

The DEV branch contains these fixtures and append-only movement/evidence records. They are preserved here as a local manifest before branch deletion.
