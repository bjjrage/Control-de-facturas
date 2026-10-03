-- set_rfq_code already allocates codes per empresa via next_doc_code.
-- The inherited global UNIQUE(code) wrongly prevents another tenant's first RFQ.
-- Preserve every existing row/code and scope uniqueness to its owning tenant.
ALTER TABLE public.rfqs DROP CONSTRAINT rfqs_code_key;
ALTER TABLE public.rfqs ADD CONSTRAINT rfqs_empresa_code_key UNIQUE(empresa_id,code);
