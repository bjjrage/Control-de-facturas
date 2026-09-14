-- =============================================================================
-- 0081_agent_approvals_execution_states.sql
--
-- BATCH 3 — Agent Actions + Approval Execution
--
-- Amplía la restricción CHECK de agent_approvals.status para soportar el ciclo de vida
-- completo de consumo atómico:
--   REQUESTED -> APPROVED -> EXECUTING -> EXECUTED (o FAILED)
-- =============================================================================

alter table public.agent_approvals
  drop constraint if exists agent_approvals_status_check;

alter table public.agent_approvals
  add constraint agent_approvals_status_check
  check (status in ('REQUESTED','APPROVED','EXECUTING','EXECUTED','REJECTED','EXPIRED','CANCELLED','FAILED'));
