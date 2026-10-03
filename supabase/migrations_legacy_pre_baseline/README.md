# Legacy migration archive

The 148 SQL files from Git base `53898dffe0a47a517bfeb31722af2f633a31486f` are preserved byte for byte. `FILE-HASHES.json` contains their SHA256 hashes, rechecked for Batch 03.

These files are historical reference only and must never be replayed or moved into the active migrations directory. Tests that inspect historical contracts now read this archive explicitly.

DB-INFRA completed the production baseline cutover before Batch 03. Active migration genesis is `20261002231537_production_schema_baseline.sql`. Batch 03 adds only new RFQ migrations and validates them on a dedicated Preview.

See `IMPLEMENTATION_REPORT-BATCH-03.md` at the repository root for integration and validation evidence. No production schema or application data is modified by Batch 03.
