-- Narrow production hotfix for the approval execution state machine.
-- The original execution-state migration also contains an unrelated purchase
-- order RPC, so this migration intentionally changes only the status check.

alter table public.agent_approvals
  drop constraint if exists agent_approvals_status_check;

alter table public.agent_approvals
  add constraint agent_approvals_status_check
  check (status in ('REQUESTED','APPROVED','EXECUTING','EXECUTED','REJECTED','EXPIRED','CANCELLED','FAILED'));
