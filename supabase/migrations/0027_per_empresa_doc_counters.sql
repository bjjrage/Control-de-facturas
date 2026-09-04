-- =============================================================================
-- 0027_per_empresa_doc_counters.sql
--
-- Reemplaza las tres secuencias globales (rfq_code_seq, order_code_seq,
-- op_code_seq) por un contador atómico por empresa y tipo de documento.
-- Mismo patrón que sales_counters (upsert ON CONFLICT DO UPDATE RETURNING).
--
-- DECISIONES DE DISEÑO (no cambiar sin consenso):
--   1. El contador NO se resetea por año. El año en el código es display-only
--      (to_char(now(), 'YYYY')). Mismo comportamiento que las secuencias globales
--      que reemplaza. Reset anual requiere cambio de esquema separado.
--   2. Códigos con formato inesperado se ignoran en la init: regex guard →
--      NULL → ignorado por MAX → COALESCE → 0. La migración no puede fallar
--      en silencio ni inicializar en 0 por parseo fallido de un código válido.
--   3. La migración es idempotente: ON CONFLICT DO UPDATE SET GREATEST.
--      Correrla dos veces no duplica filas ni retrocede contadores.
--   4. next_op_code() conserva la misma firma (sin parámetros). Usa
--      current_empresa_id() como el resto del sistema. Cero cambios en el app.
--   5. OCs originadas en RFQ tienen código 'RFQ-...' → no matchean regex
--      '^OC-...' → NULL → COALESCE 0. Solo las manuales contribuyen al MAX.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabla de contadores por empresa y tipo de documento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doc_code_counters (
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  doc_type    text NOT NULL,   -- 'RFQ' | 'OC' | 'OP'
  last_number int  NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, doc_type)
);

ALTER TABLE public.doc_code_counters ENABLE ROW LEVEL SECURITY;

-- Corrección #1: la política filtra por empresa_id del usuario.
-- Sin esto un admin de empresa A podría leer volumen de negocio de empresa B.
CREATE POLICY doc_code_counters_admin ON public.doc_code_counters
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['admin']::public.user_role[])
  );

-- ---------------------------------------------------------------------------
-- 2. Función genérica de incremento atómico
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.next_doc_code(p_empresa_id uuid, p_doc_type text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n int;
BEGIN
  IF p_empresa_id IS NULL THEN
    RAISE EXCEPTION 'next_doc_code: p_empresa_id es null — requiere contexto de empresa';
  END IF;

  INSERT INTO public.doc_code_counters (empresa_id, doc_type, last_number)
  VALUES (p_empresa_id, p_doc_type, 1)
  ON CONFLICT (empresa_id, doc_type)
  DO UPDATE SET last_number = doc_code_counters.last_number + 1
  RETURNING last_number INTO v_n;

  RETURN p_doc_type || '-' || to_char(now(), 'YYYY') || '-' || lpad(v_n::text, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Inicializar contadores desde datos existentes (Opción B)
--
--    Parseo: split_part(code, '-', 3)::int — '0047'::int = 47 (PG descarta
--    ceros líderes). Regex guard previene ::int sobre strings no numéricos.
--    COALESCE(MAX(...), 0) cubre empresas sin documentos aún.
-- ---------------------------------------------------------------------------

-- RFQs
INSERT INTO public.doc_code_counters (empresa_id, doc_type, last_number)
SELECT
  e.id,
  'RFQ',
  COALESCE(MAX(
    CASE WHEN r.code ~ '^RFQ-\d{4}-\d{1,}$'
         THEN split_part(r.code, '-', 3)::int
         ELSE NULL END
  ), 0)
FROM public.empresas e
LEFT JOIN public.rfqs r ON r.empresa_id = e.id
GROUP BY e.id
ON CONFLICT (empresa_id, doc_type)
DO UPDATE SET last_number = GREATEST(
  doc_code_counters.last_number,
  EXCLUDED.last_number
);

-- OCs manuales (OCs de RFQ tienen código 'RFQ-...' → regex falla → NULL → ignora)
INSERT INTO public.doc_code_counters (empresa_id, doc_type, last_number)
SELECT
  e.id,
  'OC',
  COALESCE(MAX(
    CASE WHEN ao.code ~ '^OC-\d{4}-\d{1,}$'
         THEN split_part(ao.code, '-', 3)::int
         ELSE NULL END
  ), 0)
FROM public.empresas e
LEFT JOIN public.authorized_orders ao ON ao.empresa_id = e.id
GROUP BY e.id
ON CONFLICT (empresa_id, doc_type)
DO UPDATE SET last_number = GREATEST(
  doc_code_counters.last_number,
  EXCLUDED.last_number
);

-- OPs
INSERT INTO public.doc_code_counters (empresa_id, doc_type, last_number)
SELECT
  e.id,
  'OP',
  COALESCE(MAX(
    CASE WHEN po.code ~ '^OP-\d{4}-\d{1,}$'
         THEN split_part(po.code, '-', 3)::int
         ELSE NULL END
  ), 0)
FROM public.empresas e
LEFT JOIN public.payment_orders po ON po.empresa_id = e.id
GROUP BY e.id
ON CONFLICT (empresa_id, doc_type)
DO UPDATE SET last_number = GREATEST(
  doc_code_counters.last_number,
  EXCLUDED.last_number
);

-- ---------------------------------------------------------------------------
-- 4. Reemplazar triggers y funciones
-- ---------------------------------------------------------------------------

-- 4a. RFQ: quitar DEFAULT de secuencia global, agregar trigger por empresa.
--     Nombre 'trg_rfqs_zcode': 'z' > 'e' → dispara DESPUÉS de trg_rfqs_empresa
--     (que ya seteó new.empresa_id). Confirmado: trg_rfqs_empresa existe en 0011.
ALTER TABLE public.rfqs ALTER COLUMN code DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.set_rfq_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.code IS NULL OR new.code = '' THEN
    new.code := public.next_doc_code(new.empresa_id, 'RFQ');
  END IF;
  RETURN new;
END;
$$;

CREATE TRIGGER trg_rfqs_zcode
  BEFORE INSERT ON public.rfqs
  FOR EACH ROW EXECUTE FUNCTION public.set_rfq_code();

-- 4b. OC: set_order_code() ya existe y el trigger trg_authorized_orders_code
--     apunta a ella. Solo reemplazamos la función; el trigger se actualiza solo.
CREATE OR REPLACE FUNCTION public.set_order_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new.code IS NULL THEN
    new.code := public.next_doc_code(new.empresa_id, 'OC');
  END IF;
  RETURN new;
END;
$$;

-- 4c. OP: misma firma que hoy (sin parámetros), cero cambios en el app.
--     Corrección #2: RAISE EXCEPTION explícito si empresa_id es null.
CREATE OR REPLACE FUNCTION public.next_op_code()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_eid uuid;
BEGIN
  v_eid := public.current_empresa_id();
  IF v_eid IS NULL THEN
    RAISE EXCEPTION 'next_op_code: current_empresa_id() es null — requiere sesión de usuario autenticado';
  END IF;
  RETURN public.next_doc_code(v_eid, 'OP');
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Eliminar secuencias globales
--    Solo se ejecuta aquí, cuando ya nada las usa.
-- ---------------------------------------------------------------------------
DROP SEQUENCE IF EXISTS public.rfq_code_seq;
DROP SEQUENCE IF EXISTS public.order_code_seq;
DROP SEQUENCE IF EXISTS public.op_code_seq;
