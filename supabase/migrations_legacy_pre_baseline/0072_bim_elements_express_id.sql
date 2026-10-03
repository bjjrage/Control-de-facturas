-- =============================================================================
-- 0072_bim_elements_express_id.sql
--
-- El viewer 3D necesita, para cada bim_element, el STEP expressID del
-- elemento dentro del archivo IFC original (no solo el GlobalId): es lo que
-- web-ifc usa como handle para geometría (LoadAllGeometry/GetFlatMesh) y para
-- raycasting/selección en el viewer. El expressID es estable para un mismo
-- archivo STEP (es el número de línea de la entidad), así que persistirlo es
-- seguro siempre que el viewer reabra el mismo binario ya subido a Storage.
-- =============================================================================

ALTER TABLE public.bim_elements
  ADD COLUMN IF NOT EXISTS express_id integer;

CREATE INDEX IF NOT EXISTS idx_bim_elements_express_id
  ON public.bim_elements(bim_model_id, express_id);
