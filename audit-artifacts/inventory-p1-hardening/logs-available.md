# Log availability and MIGRATIONS_FAILED diagnosis

## Available evidence

- Supabase branch metadata before deletion:
  - `status = MIGRATIONS_FAILED`
  - `preview_project_status = ACTIVE_HEALTHY`
  - `created_at = 2026-09-14T02:53:57.458807+00:00`
  - `updated_at = 2026-09-14T02:53:57.458807+00:00`
- `supabase_migrations.schema_migrations` rows, statement lengths and MD5s are preserved in `migration-history.md`.
- The three inventory statements are committed and match the local files.
- The Postgres catalog audit and runtime checks are preserved in `schema-snapshot.md`.
- The successful real smoke observations are preserved in `smoke-results.md`.

## Unavailable evidence

The read-only Supabase MCP surface did not expose the Branching workflow log or Postgres migration log for this branch. The available browser dashboard session was not authenticated, so no credentials or login action was attempted. Postgres has no failed-migration table exposed here; `schema_migrations` only records committed migrations and has no error/timestamp columns.

Therefore the exact failed migration attempt, error text and exact failure timestamp cannot be recovered from the available read-only surfaces. No claim is made that baseline, hardening or transfer fix failed: all three are present as committed rows and their statements match the local files.

## Conclusion before deletion

The flag is historical/control-plane metadata from an attempt that is not represented as an incomplete Postgres migration. No inventory object is partial or inconsistent. Deleting the DEV branch will remove the remote fixtures and any branch-only control-plane log retention, but the code, migrations, hashes, schema observations, fixture IDs and smoke results are preserved in this local Git archive.
