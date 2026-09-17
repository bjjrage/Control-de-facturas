-- =============================================================================
-- 0093_quotation_token_evidence_lock.sql — Fix mínimo post-certificación §11e
--
-- Conflicto confirmado: `sales_quotation_acceptances.token_id → tokens
-- ON DELETE SET NULL` necesita un UPDATE sobre el acceptance al borrar el
-- token, y el trigger append-only de 0092 (exigido, sin excepciones) lo
-- bloquea. Decisión de diseño: el Acceptance Record es absolutamente
-- inmutable, por lo que la FK pasa a ON DELETE RESTRICT (misma semántica
-- explícita que quotation/client/empresa).
--
-- Regla resultante: un token que participó en una aceptación NO puede
-- eliminarse (se conserva como evidencia); para inutilizarlo se usa
-- revoked_at/estado, nunca DELETE. Tokens sin aceptación siguen
-- eliminables (revocar es el camino normal; no hay trigger en tokens).
--
-- Sin cambios de lógica de negocio ni de esquema adicional. DO block
-- fail-fast exige: ningún CASCADE hacia acceptances y token_id
-- explícitamente RESTRICT/NO ACTION (ni CASCADE ni SET NULL).
-- =============================================================================

ALTER TABLE public.sales_quotation_acceptances
  DROP CONSTRAINT IF EXISTS sales_quotation_acceptances_token_id_fkey;
ALTER TABLE public.sales_quotation_acceptances
  ADD CONSTRAINT sales_quotation_acceptances_token_id_fkey
    FOREIGN KEY (token_id) REFERENCES public.sales_quotation_tokens(id) ON DELETE RESTRICT;

DO $$
DECLARE
  v_bad int;
BEGIN
  -- Ningún CASCADE hacia acceptances (ninguna vía de borrado indirecto).
  SELECT count(*) INTO v_bad FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'sales_quotation_acceptances' AND c.contype = 'f' AND c.confdeltype = 'c';
  IF v_bad > 0 THEN RAISE EXCEPTION 'AUDIT: existe ON DELETE CASCADE hacia acceptances'; END IF;

  -- token_id explícitamente RESTRICT/NO ACTION (ni CASCADE ni SET NULL).
  SELECT count(*) INTO v_bad FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'sales_quotation_acceptances' AND c.contype = 'f'
    AND (SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum = c.conkey[1]) = 'token_id'
    AND c.confdeltype NOT IN ('r', 'a');
  IF v_bad > 0 THEN RAISE EXCEPTION 'AUDIT: FK token_id de acceptances no es RESTRICT'; END IF;

  -- Triggers append-only intactos (defensa en profundidad del 0092).
  PERFORM 1 FROM pg_trigger WHERE tgname = 'trg_acceptances_no_update';
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT: falta trg_acceptances_no_update'; END IF;
  PERFORM 1 FROM pg_trigger WHERE tgname = 'trg_acceptances_no_delete';
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT: falta trg_acceptances_no_delete'; END IF;
END $$;
