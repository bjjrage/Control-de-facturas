-- Run right after applying 0011_multi_tenant.sql.
-- Every check should return zero offending rows / the expected counts.

-- 1. No NULL empresa_id on the not-null domain tables, all pointing at niu.pack.
with niupack as (select id from public.empresas where slug = 'niupack')
select 'providers' as tbl, count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) as bad from public.providers
union all select 'rfqs', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.rfqs
union all select 'rfq_providers', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.rfq_providers
union all select 'attachments', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.attachments
union all select 'quotes', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.quotes
union all select 'quote_versions', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.quote_versions
union all select 'authorized_orders', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.authorized_orders
union all select 'invoices', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.invoices
union all select 'invoice_order_matches', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.invoice_order_matches
union all select 'invoice_exceptions', count(*) filter (where empresa_id is null or empresa_id <> (select id from niupack)) from public.invoice_exceptions
union all select 'audit_logs', count(*) filter (where empresa_id is null) from public.audit_logs;

-- 2. Every active profile has an empresa (else that user 403s on everything).
select id, email from public.profiles where active and empresa_id is null;

-- 3. Every domain-table policy references current_empresa_id().
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('providers','rfqs','rfq_providers','attachments','quotes',
    'quote_versions','authorized_orders','invoices','invoice_order_matches',
    'invoice_exceptions')
  and coalesce(qual, '') || coalesce(with_check, '') not like '%current_empresa_id%';

-- 4. empresa_id index present on all 12 tables.
select unnest(array['providers','rfqs','rfq_providers','attachments','quotes',
    'quote_versions','authorized_orders','invoices','invoice_order_matches',
    'invoice_exceptions','audit_logs','profiles']) as tbl
except
select tablename from pg_indexes
where schemaname = 'public' and indexdef like '%(empresa_id)%';
