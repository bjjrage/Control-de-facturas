# Migration policy

## APPLIED MIGRATIONS ARE IMMUTABLE

A migration that reached any shared environment must never be edited, renamed or removed from the active history. Corrections require a new migration created with Supabase CLI.

The one-time production baseline cutover replaces inconsistent historical tracking only after a clean apply and structural parity pass. The archived pre-baseline files are historical reference only and must never be replayed.

Production application DDL and data must not be changed by the baseline cutover. The production baseline SQL is never executed on production; only its migration-history record is marked applied.

Every future migration must be validated against a fresh environment created from the baseline. Never repair history to claim an application change has been applied without verifying its actual state.

