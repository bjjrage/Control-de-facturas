# Legacy migration archive

Prepared on 2026-10-02 UTC from Git base 53898dffe0a47a517bfeb31722af2f633a31486f.

The 148 original files are preserved byte for byte. Their hashes are recorded in scripts/baseline-cutover/legacy-file-hashes.json.

Historical migrations were edited after deployment and the remote ledger no longer replays production faithfully. This archive is historical reference only. These files must never be replayed or moved back into the active migrations directory.

The production schema snapshot is the source of truth. The production_schema_baseline migration is the new migration genesis after the validation gates and metadata cutover succeed. Until then the production ledger remains unchanged.

See BASELINE_CUTOVER_RESULT.md for the actual cutover date, status and evidence.

