-- =============================================================================
-- 0074_bim_group_review_required.sql
--
-- Agrega el estado REVIEW_REQUIRED a bim_group_matches: distinto de REVIEW.
-- REVIEW es la abstención de DeepSeek ante ambigüedad semántica (ej. "Floor
-- finish" con varios pisos posibles). REVIEW_REQUIRED es una conclusión de la
-- capa de validación técnica (lib/bim/technical-integrity.ts) que corre ANTES
-- del matching: el input mismo llegó contradictorio (espesor/resistencia/
-- material en conflicto entre name/material/properties) o expresa un rango
-- que deja más de un candidato plausible. DeepSeek puede seguir participando
-- y proponiendo un candidato (por eso budget_item_id queda permitido, no
-- requerido, para este estado) pero el sistema nunca lo deja confirmar con
-- un clic — la UI exige elegir manualmente (ver bim-section.tsx).
-- =============================================================================

ALTER TABLE public.bim_group_matches DROP CONSTRAINT IF EXISTS bim_group_matches_status_check;
ALTER TABLE public.bim_group_matches
  ADD CONSTRAINT bim_group_matches_status_check
  CHECK (status IN ('SUGGESTED', 'REVIEW', 'REVIEW_REQUIRED', 'NO_MATCH', 'CONFIRMED', 'REJECTED'));

ALTER TABLE public.bim_group_matches DROP CONSTRAINT IF EXISTS bim_group_matches_budget_item_required;
ALTER TABLE public.bim_group_matches
  ADD CONSTRAINT bim_group_matches_budget_item_required
  CHECK (
    (status IN ('SUGGESTED', 'CONFIRMED') AND budget_item_id IS NOT NULL)
    OR status IN ('REVIEW', 'REVIEW_REQUIRED', 'NO_MATCH', 'REJECTED')
  );
