-- QA only: run concurrently in two sessions, explicitly pinned to
-- --project-ref kyiihlkncatojvlasoag. Uses the existing synthetic tenant/actor.
-- Creates/reuses one BORRADOR with no providers; sends no messages.
BEGIN;
SELECT set_config('request.jwt.claim.sub','6037b09a-c8b4-4aa5-9c3a-f655330bf430',true);
SET LOCAL ROLE authenticated;
SELECT set_config('qa.cost_rfq_result',public.rfq_create_cost_once(
 jsonb_build_object('purpose','COST_DISCOVERY','project_id',(SELECT id FROM public.projects WHERE empresa_id='f775a9e6-30a6-4156-98f7-bfed0e8d87da' ORDER BY id LIMIT 1),'product','QA-PR38-25-CONCURRENT-20261019-1400'),
 (SELECT jsonb_build_array(jsonb_build_object('producto_id',id,'descripcion',nombre,'cantidad',2,'unidad',unidad)) FROM public.productos WHERE empresa_id='f775a9e6-30a6-4156-98f7-bfed0e8d87da' AND activo AND unidad IS NOT NULL AND btrim(unidad)<>'' ORDER BY id LIMIT 1),
 '{}'::uuid[])::text,false);
SELECT pg_sleep(2);
COMMIT;
SELECT current_setting('qa.cost_rfq_result')::jsonb result;
