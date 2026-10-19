-- READ ONLY. Run only with --project-ref kyiihlkncatojvlasoag.
select jsonb_build_object('views', (select jsonb_agg(v) from (select c.relname, pg_get_userbyid(c.relowner) as owner, c.reloptions,
 pg_get_viewdef(c.oid, true) as definition,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('v_procurement_competitor_contextual','v_procurement_competitor_global')) v),
'source_rls', (select jsonb_agg(v) from (
select t.relname, t.relrowsecurity, p.polname, pg_get_expr(p.polqual,p.polrelid) as using_expression
from pg_class t left join pg_policy p on p.polrelid=t.oid
where t.relname in ('procurement_bids','procurement_suppliers','procurement_processes')) v),
'source_columns',(select jsonb_agg(v) from (
select column_name,data_type from information_schema.columns where table_schema='public'
and table_name in ('procurement_bids','procurement_suppliers','procurement_processes') order by table_name,ordinal_position) v));
