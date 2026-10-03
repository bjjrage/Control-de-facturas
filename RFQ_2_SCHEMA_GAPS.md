# RFQ 2.0 — schema gap resolved

The previous schema gap checkpoint is superseded by the user's RFQ 2.0 FULL AUTOPILOT authorization after DB-INFRA closed.

`rfqs.purpose` is now implemented through a new migration with `COST_DISCOVERY` / `PROCUREMENT`, nullable and without a default. Historical NULL values remain unchanged. New RFQs require an explicit human choice. There is no inference from quote_type, item count or project, and no production backfill.

The complete implementation, immutable migrations, Preview evidence and test results are recorded in `IMPLEMENTATION_REPORT-BATCH-03.md`. This document no longer represents a STOP.
