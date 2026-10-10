# Remediation 3 independent review record

Status: review and exact-head CI certification in progress. This record does not
grant production migration, merge or deployment authorization.

Three independent subagents reviewed SQL, runtime/worker and real-PostgreSQL test
design. Root also reviewed the implementation, permissions and harness. Review
comments were used to change code; a reviewer approval by itself is not evidence
of a passing release gate.

| Finding | Required closure |
| --- | --- |
| Concurrent allocations can exceed documented/ordered quantities | RPC post-lock checks, real cross-invoice race and final counters |
| Corrections lose source IDs or partially delete allocations | In-place RPC correction and rollback assertions |
| Header unlink races with allocation | Expected relationship identity and canonical lock ordering |
| Raw writes bypass the invariants | Privilege revocation, source guards and negative role/tenant tests |
| Invoice deletion cleans metadata before paid-state rejection | One OP-first transactional delete RPC and payment-execution race |
| Shared or forged attachment metadata deletes unrelated Storage | Last-reference metadata deletion, owned bucket/path cleanup contract, adversarial fixtures |
| Retry/manual resolution races reopen processing jobs | Conditional state claims and negative race tests |
| Expired worker can overwrite newer work | Attempt-fenced creation/finish and stale-recovery assertions |
| Retry reset or stale snapshot reuses an old attempt token | Monotonic counter, snapshot CAS, database fencing guard and raw-write denial tests |
| Invoice creation and job checkpoint can split across a crash | Atomic invoice-from-job RPC and forced-failure rollback/concurrent-create tests |
| Discard races with manual resolution | Conditional delete before Storage work, no deletion of processing/known-invoice jobs |
| Partial reconciliation appears complete | Explicit warnings/review state for failed or skipped allocations |
| Non-finite or silently rounded numeric values | Finite validation and exact persisted decimal precision |
| Two uploads use the same millisecond destination | UUID destinations and confirmed metadata cleanup before deleting Storage |

PGlite tests cover sequential SQL behavior only. PostgreSQL 17 independent-session
tests, full Vitest, production build, TypeScript, scoped lint and browser actions
must all pass on the final PR head before this record becomes a closure verdict.

An automatic approval review rejected a proposed unscoped audit-row deletion
because an invoice ID could also appear in another tenant's audit metadata. The
implemented deletion is scoped to the invoice tenant plus legacy NULL-tenant
records. Mismatched-tenant rows are preserved and an FK conflict rolls the entire
operation back. No broad deletion was performed.
