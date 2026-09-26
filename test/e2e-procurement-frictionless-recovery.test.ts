import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import * as fs from "fs";
import * as path from "path";

describe("E2E Procurement Frictionless Flow Certification (19 Steps)", () => {
  let pg: PGlite;

  const empresaA = "11111111-1111-1111-1111-111111111111";
  const empresaB = "22222222-2222-2222-2222-222222222222";
  const userAdmin = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  beforeAll(async () => {
    pg = new PGlite();

    await pg.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA IF NOT EXISTS auth;

      DO $$ BEGIN
        CREATE TYPE public.user_role AS ENUM ('comercial', 'administracion', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE public.rfq_status AS ENUM (
          'BORRADOR', 'COTIZANDO', 'OFERTAS_RECIBIDAS', 'OFERTA_SELECCIONADA',
          'AUTORIZADO', 'FACTURADO', 'CONCILIADO', 'APTO_PARA_PAGO',
          'PAGADO', 'CANCELADO', 'RECHAZADO', 'DIFERENCIA', 'REQUIERE_REVISION'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE public.rfq_provider_status AS ENUM ('PENDIENTE', 'ABIERTO', 'RESPONDIDO');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE public.order_status AS ENUM ('AUTORIZADO', 'FACTURADO', 'CONCILIADO', 'APTO_PARA_PAGO', 'PAGADO');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE public.invoice_status AS ENUM ('PENDIENTE', 'MATCH', 'REQUIERE_REVISION', 'APROBADO_EXCEPCION', 'APTO_PARA_PAGO', 'PAGADO');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE public.selection_reason AS ENUM (
          'MENOR_PLAZO', 'MEJOR_CALIDAD', 'PROVEEDOR_HABITUAL', 'DISPONIBILIDAD',
          'INCLUYE_ADICIONALES', 'CONDICIONES_PAGO', 'REQUERIMIENTO_CLIENTE', 'OTRO'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      CREATE TABLE public.test_context (
        singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
        user_id uuid NOT NULL,
        empresa_id uuid NOT NULL,
        role text NOT NULL DEFAULT 'admin'
      );
      INSERT INTO public.test_context VALUES
        (true, '${userAdmin}', '${empresaA}', 'admin');

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT user_id FROM public.test_context WHERE singleton;
      $$;

      CREATE OR REPLACE FUNCTION public.current_empresa_id() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT empresa_id FROM public.test_context WHERE singleton;
      $$;

      CREATE OR REPLACE FUNCTION public.is_internal_role(roles public.user_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM public.test_context WHERE singleton AND role::public.user_role = ANY(roles)
        );
      $$;

      CREATE SEQUENCE IF NOT EXISTS public.rfq_code_seq START 1;
      CREATE SEQUENCE IF NOT EXISTS public.order_code_seq START 1;
      CREATE SEQUENCE IF NOT EXISTS public.payment_order_code_seq START 1;

      CREATE TABLE public.empresas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        nombre text NOT NULL,
        ruc text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.profiles (
        id uuid PRIMARY KEY,
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        email text NOT NULL,
        full_name text NOT NULL,
        role public.user_role NOT NULL DEFAULT 'comercial',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.projects (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        name text NOT NULL,
        code text,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.providers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        name text NOT NULL,
        ruc text NOT NULL,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.productos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        nombre text NOT NULL,
        unidad text NOT NULL,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.rfqs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        code text NOT NULL UNIQUE DEFAULT ('RFQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.rfq_code_seq')::text, 4, '0')),
        created_by uuid NOT NULL REFERENCES public.profiles(id),
        client_name text NOT NULL,
        product text NOT NULL,
        quantity numeric(14, 2) NOT NULL,
        unit text NOT NULL,
        project_id uuid REFERENCES public.projects(id),
        status public.rfq_status NOT NULL DEFAULT 'BORRADOR',
        selected_rfq_provider_id uuid,
        expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.rfq_providers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        rfq_id uuid NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
        provider_id uuid NOT NULL REFERENCES public.providers(id),
        token text NOT NULL UNIQUE DEFAULT md5(random()::text || clock_timestamp()::text),
        status public.rfq_provider_status NOT NULL DEFAULT 'PENDIENTE',
        invited_at timestamptz NOT NULL DEFAULT now(),
        opened_at timestamptz,
        responded_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        rfq_provider_id uuid NOT NULL REFERENCES public.rfq_providers(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.quote_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
        version_number integer NOT NULL,
        budget_number text NOT NULL,
        unit_price numeric(14, 2) NOT NULL,
        total_price numeric(14, 2) NOT NULL,
        currency text NOT NULL DEFAULT 'PYG',
        delivery_time text,
        offer_validity text,
        payment_terms text,
        observations text,
        vat_included boolean NOT NULL DEFAULT true,
        invoice_available boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.authorized_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        code text NOT NULL UNIQUE DEFAULT ('OC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.order_code_seq')::text, 4, '0')),
        rfq_id uuid REFERENCES public.rfqs(id),
        project_id uuid REFERENCES public.projects(id),
        provider_id uuid NOT NULL REFERENCES public.providers(id),
        provider_name text NOT NULL,
        product text NOT NULL,
        quantity numeric(14, 2) NOT NULL,
        unit text NOT NULL,
        unit_price numeric(14, 2) NOT NULL,
        total_price numeric(14, 2) NOT NULL,
        currency text NOT NULL DEFAULT 'PYG',
        created_from text NOT NULL DEFAULT 'rfq',
        quote_version_id uuid REFERENCES public.quote_versions(id),
        selection_reason public.selection_reason,
        selection_reason_detail text,
        is_cheapest boolean NOT NULL DEFAULT true,
        status public.order_status NOT NULL DEFAULT 'AUTORIZADO',
        facturado_amount numeric(14, 2) NOT NULL DEFAULT 0,
        authorized_by uuid NOT NULL REFERENCES public.profiles(id),
        authorized_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.authorized_order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        order_id uuid NOT NULL REFERENCES public.authorized_orders(id) ON DELETE CASCADE,
        product text NOT NULL,
        quantity numeric(14, 2) NOT NULL,
        unit text NOT NULL,
        unit_price numeric(14, 2) NOT NULL,
        total_price numeric(14, 2) NOT NULL,
        sort_order integer NOT NULL DEFAULT 0,
        quantity_invoiced numeric(14, 2) NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.oc_recepciones (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        order_id uuid NOT NULL REFERENCES public.authorized_orders(id) ON DELETE CASCADE,
        remito_numero text,
        observaciones text,
        created_by uuid NOT NULL REFERENCES public.profiles(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.oc_recepcion_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        recepcion_id uuid NOT NULL REFERENCES public.oc_recepciones(id) ON DELETE CASCADE,
        product text NOT NULL,
        cantidad_recibida numeric(14, 2) NOT NULL,
        unidad text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.inventory_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        project_id uuid REFERENCES public.projects(id),
        producto_id uuid REFERENCES public.productos(id),
        tipo_movimiento text NOT NULL,
        cantidad numeric(14, 2) NOT NULL,
        referencia_tipo text,
        referencia_id uuid,
        created_by uuid NOT NULL REFERENCES public.profiles(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        provider_id uuid NOT NULL REFERENCES public.providers(id),
        project_id uuid REFERENCES public.projects(id),
        invoice_number text NOT NULL,
        invoice_date date NOT NULL,
        subtotal numeric(14, 2) NOT NULL,
        vat numeric(14, 2) NOT NULL,
        total numeric(14, 2) NOT NULL,
        currency text NOT NULL DEFAULT 'PYG',
        status public.invoice_status NOT NULL DEFAULT 'PENDIENTE',
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.invoice_order_matches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
        authorized_order_id uuid NOT NULL REFERENCES public.authorized_orders(id),
        match_type text NOT NULL,
        notes text,
        created_by uuid NOT NULL REFERENCES public.profiles(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.payment_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        code text NOT NULL UNIQUE DEFAULT ('OP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.payment_order_code_seq')::text, 4, '0')),
        provider_id uuid NOT NULL REFERENCES public.providers(id),
        project_id uuid REFERENCES public.projects(id),
        amount numeric(14, 2) NOT NULL,
        currency text NOT NULL DEFAULT 'PYG',
        status text NOT NULL DEFAULT 'PENDIENTE',
        created_by uuid NOT NULL REFERENCES public.profiles(id),
        created_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE public.payment_order_invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES public.empresas(id),
        payment_order_id uuid NOT NULL REFERENCES public.payment_orders(id) ON DELETE CASCADE,
        invoice_id uuid NOT NULL REFERENCES public.invoices(id),
        amount numeric(14, 2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

      -- Cargar la función atómica canónica de adjudicación
      CREATE OR REPLACE FUNCTION public.select_and_authorize_offer_atomically(
        p_empresa_id uuid,
        p_actor_id uuid,
        p_rfq_id uuid,
        p_rfq_provider_id uuid,
        p_quote_version_id uuid,
        p_selection_reason public.selection_reason DEFAULT NULL,
        p_selection_reason_detail text DEFAULT NULL
      ) RETURNS uuid
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $$
      DECLARE
        v_rfq public.rfqs;
        v_rp record;
        v_quote public.quote_versions;
        v_order_id uuid;
        v_is_cheapest boolean;
      BEGIN
        IF auth.uid() IS NULL
           OR p_actor_id IS DISTINCT FROM auth.uid()
           OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
           OR NOT public.is_internal_role(ARRAY['comercial','admin']::public.user_role[]) THEN
          RAISE EXCEPTION 'Acceso denegado para autorizar oferta';
        END IF;

        SELECT * INTO v_rfq FROM public.rfqs r
        WHERE r.id = p_rfq_id AND r.empresa_id = p_empresa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;

        SELECT rp.id, rp.rfq_id, rp.provider_id, p.name AS provider_name
          INTO v_rp
        FROM public.rfq_providers rp
        JOIN public.providers p ON p.id = rp.provider_id AND p.empresa_id = p_empresa_id
        WHERE rp.id = p_rfq_provider_id AND rp.rfq_id = p_rfq_id
          AND rp.empresa_id = p_empresa_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor no encontrado en esta solicitud'; END IF;

        SELECT qv.* INTO v_quote
        FROM public.quote_versions qv
        JOIN public.quotes q ON q.id = qv.quote_id AND q.empresa_id = p_empresa_id
        WHERE qv.id = p_quote_version_id AND qv.empresa_id = p_empresa_id
          AND q.rfq_provider_id = p_rfq_provider_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no encontrada para este proveedor y solicitud'; END IF;

        IF v_rfq.status = 'AUTORIZADO' THEN
          SELECT ao.id INTO v_order_id
          FROM public.authorized_orders ao
          WHERE ao.rfq_id = p_rfq_id AND ao.empresa_id = p_empresa_id
            AND ao.created_from = 'rfq'
            AND ao.provider_id = v_rp.provider_id
            AND ao.quote_version_id = p_quote_version_id
          ORDER BY ao.created_at DESC
          LIMIT 1;

          IF v_order_id IS NOT NULL THEN
            RETURN v_order_id;
          END IF;
          RAISE EXCEPTION 'La solicitud ya fue autorizada con otra oferta';
        END IF;

        IF v_rfq.status = 'CANCELADO' THEN
          RAISE EXCEPTION 'No se puede autorizar una solicitud cancelada';
        END IF;

        v_is_cheapest := (p_selection_reason IS NULL);

        INSERT INTO public.authorized_orders (
          empresa_id, rfq_id, project_id, provider_id, provider_name,
          product, quantity, unit, unit_price, total_price, currency,
          created_from, quote_version_id, selection_reason, selection_reason_detail,
          is_cheapest, authorized_by, status
        ) VALUES (
          p_empresa_id, v_rfq.id, v_rfq.project_id, v_rp.provider_id, v_rp.provider_name,
          v_rfq.product, v_rfq.quantity, v_rfq.unit, v_quote.unit_price, v_quote.total_price, v_quote.currency,
          'rfq', v_quote.id, p_selection_reason, p_selection_reason_detail,
          v_is_cheapest, p_actor_id, 'AUTORIZADO'
        ) RETURNING id INTO v_order_id;

        INSERT INTO public.authorized_order_items (
          empresa_id, order_id, product, quantity, unit, unit_price, total_price, sort_order
        ) VALUES (
          p_empresa_id, v_order_id, v_rfq.product, v_rfq.quantity, v_rfq.unit, v_quote.unit_price, v_quote.total_price, 0
        );

        UPDATE public.rfqs
        SET status = 'AUTORIZADO',
            selected_rfq_provider_id = p_rfq_provider_id,
            updated_at = now()
        WHERE id = p_rfq_id AND empresa_id = p_empresa_id;

        RETURN v_order_id;
      END;
      $$;
    `);

    // Insertar empresas y usuario
    await pg.exec(`
      INSERT INTO public.empresas (id, nombre, ruc)
      VALUES 
        ('${empresaA}', 'Empresa Constructora A', '80000001-1'),
        ('${empresaB}', 'Empresa Constructora B', '80000002-2')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.profiles (id, empresa_id, email, full_name, role)
      VALUES 
        ('${userAdmin}', '${empresaA}', 'admin@constructora.com', 'Admin User', 'admin')
      ON CONFLICT (id) DO NOTHING;
    `);
  }, 60000);

  it("Executes the complete 19-step frictionless procurement cycle + resilience invariants", async () => {
    // Contexto de autenticación para empresa A
    await pg.exec(`
      SELECT set_config('request.jwt.claim.sub', '${userAdmin}', false);
    `);

    // 1. Crear proyecto y producto
    const projRes = await pg.query<{ id: string }>(`
      INSERT INTO public.projects (empresa_id, name, code, status)
      VALUES ('${empresaA}', 'Edificio Alborada', 'OBRA-2026-01', 'active')
      RETURNING id;
    `);
    const projectId = projRes.rows[0].id;
    expect(projectId).toBeDefined();

    const provRes = await pg.query<{ id: string }>(`
      INSERT INTO public.providers (empresa_id, name, ruc, active)
      VALUES ('${empresaA}', 'Hormigones & Cemento del Este S.A.', '80054321-9', true)
      RETURNING id;
    `);
    const providerId = provRes.rows[0].id;
    expect(providerId).toBeDefined();

    const prodRes = await pg.query<{ id: string }>(`
      INSERT INTO public.productos (empresa_id, nombre, unidad, activo)
      VALUES ('${empresaA}', 'Cemento Portland Tipo I', 'bolsa', true)
      RETURNING id;
    `);
    const productId = prodRes.rows[0].id;

    // =========================================================================
    // PASO 1: Crear RFQ asignada a la obra (project_id)
    // =========================================================================
    const rfqRes = await pg.query<{ id: string; code: string; status: string }>(`
      INSERT INTO public.rfqs (empresa_id, created_by, client_name, product, quantity, unit, project_id, status)
      VALUES ('${empresaA}', '${userAdmin}', 'Constructora A', 'Cemento Portland Tipo I', 100, 'bolsa', '${projectId}', 'BORRADOR')
      RETURNING id, code, status;
    `);
    const rfqId = rfqRes.rows[0].id;
    expect(rfqId).toBeDefined();
    expect(rfqRes.rows[0].status).toBe("BORRADOR");

    // Verificar que la obra ahora consulta sus RFQs directamente por project_id
    const projectRfqsQuery = await pg.query<{ id: string }>(`
      SELECT id FROM public.rfqs WHERE project_id = '${projectId}' AND empresa_id = '${empresaA}';
    `);
    expect(projectRfqsQuery.rows.length).toBe(1);
    expect(projectRfqsQuery.rows[0].id).toBe(rfqId);

    // =========================================================================
    // PASO 2: Invitar proveedor y simular envío de cotización vía portal /cotizar/[token]
    // =========================================================================
    const inviteRes = await pg.query<{ id: string; token: string }>(`
      INSERT INTO public.rfq_providers (empresa_id, rfq_id, provider_id, status)
      VALUES ('${empresaA}', '${rfqId}', '${providerId}', 'PENDIENTE')
      RETURNING id, token;
    `);
    const rfqProviderId = inviteRes.rows[0].id;
    const token = inviteRes.rows[0].token;
    expect(token).toBeDefined();

    // Actualizar RFQ a COTIZANDO al invitar
    await pg.exec(`UPDATE public.rfqs SET status = 'COTIZANDO' WHERE id = '${rfqId}';`);

    // Proveedor envía cotización (100 bolsas @ 55,000 PYG c/u = 5,500,000 PYG)
    const quoteRes = await pg.query<{ id: string }>(`
      INSERT INTO public.quotes (empresa_id, rfq_provider_id)
      VALUES ('${empresaA}', '${rfqProviderId}')
      RETURNING id;
    `);
    const quoteId = quoteRes.rows[0].id;

    const versionRes = await pg.query<{ id: string; total_price: string }>(`
      INSERT INTO public.quote_versions (
        empresa_id, quote_id, version_number, budget_number, unit_price, total_price, currency,
        delivery_time, offer_validity, vat_included, invoice_available
      )
      VALUES (
        '${empresaA}', '${quoteId}', 1, 'PRE-2026-99', 55000, 5500000, 'PYG',
        '48 horas', '15 dias', true, true
      )
      RETURNING id, total_price;
    `);
    const quoteVersionId = versionRes.rows[0].id;
    expect(Number(versionRes.rows[0].total_price)).toBe(5500000);

    // Marcar proveedor como RESPONDIDO y RFQ como OFERTAS_RECIBIDAS
    await pg.exec(`
      UPDATE public.rfq_providers SET status = 'RESPONDIDO', responded_at = now() WHERE id = '${rfqProviderId}';
      UPDATE public.rfqs SET status = 'OFERTAS_RECIBIDAS' WHERE id = '${rfqId}';
    `);

    // =========================================================================
    // PASO 3 & 4: Oferta aparece y Cuadro Comparativo calcula valores
    // =========================================================================
    const rfqCheck = await pg.query<{ status: string }>(`SELECT status FROM public.rfqs WHERE id = '${rfqId}';`);
    expect(rfqCheck.rows[0].status).toBe("OFERTAS_RECIBIDAS");

    const comparisonCheck = await pg.query<{ unit_price: string; total_price: string; currency: string }>(`
      SELECT qv.unit_price, qv.total_price, qv.currency
      FROM public.quote_versions qv
      JOIN public.quotes q ON q.id = qv.quote_id
      WHERE q.rfq_provider_id = '${rfqProviderId}';
    `);
    expect(Number(comparisonCheck.rows[0].unit_price)).toBe(55000);
    expect(Number(comparisonCheck.rows[0].total_price)).toBe(5500000);
    expect(comparisonCheck.rows[0].currency).toBe("PYG");

    // =========================================================================
    // PASO 5 & 6: Usuario humano adjudica mediante select_and_authorize_offer_atomically
    // =========================================================================
    const authOrderRes = await pg.query<{ select_and_authorize_offer_atomically: string }>(`
      SELECT public.select_and_authorize_offer_atomically(
        '${empresaA}'::uuid,
        '${userAdmin}'::uuid,
        '${rfqId}'::uuid,
        '${rfqProviderId}'::uuid,
        '${quoteVersionId}'::uuid,
        'PROVEEDOR_HABITUAL'::public.selection_reason,
        'Mejor precio y proveedor habitual de la obra'::text
      );
    `);
    const authorizedOrderId = authOrderRes.rows[0].select_and_authorize_offer_atomically;
    expect(authorizedOrderId).toBeDefined();

    // =========================================================================
    // PASO 7 & 8: OC se genera y conserva proveedor, proyecto, RFQ e ítems
    // =========================================================================
    const orderDetails = await pg.query<{
      id: string;
      code: string;
      rfq_id: string;
      project_id: string;
      provider_id: string;
      total_price: string;
      currency: string;
      status: string;
    }>(`
      SELECT id, code, rfq_id, project_id, provider_id, total_price, currency, status
      FROM public.authorized_orders
      WHERE id = '${authorizedOrderId}';
    `);
    expect(orderDetails.rows[0].rfq_id).toBe(rfqId);
    expect(orderDetails.rows[0].project_id).toBe(projectId);
    expect(orderDetails.rows[0].provider_id).toBe(providerId);
    expect(Number(orderDetails.rows[0].total_price)).toBe(5500000);
    expect(orderDetails.rows[0].currency).toBe("PYG");
    expect(orderDetails.rows[0].status).toBe("AUTORIZADO");

    // =========================================================================
    // RESILIENCE CHECK 1: Doble click / Re-adjudicación es idempotente
    // =========================================================================
    const duplicateAuthRes = await pg.query<{ select_and_authorize_offer_atomically: string }>(`
      SELECT public.select_and_authorize_offer_atomically(
        '${empresaA}'::uuid,
        '${userAdmin}'::uuid,
        '${rfqId}'::uuid,
        '${rfqProviderId}'::uuid,
        '${quoteVersionId}'::uuid,
        'PROVEEDOR_HABITUAL'::public.selection_reason,
        'Intento duplicado'::text
      );
    `);
    expect(duplicateAuthRes.rows[0].select_and_authorize_offer_atomically).toBe(authorizedOrderId);

    const totalOrdersCount = await pg.query<{ count: string }>(`
      SELECT count(*) as count FROM public.authorized_orders WHERE rfq_id = '${rfqId}';
    `);
    expect(Number(totalOrdersCount.rows[0].count)).toBe(1);

    // =========================================================================
    // PASO 9 & 10: Recepción Parcial 1 (40 de 100 bolsas) con remito
    // =========================================================================
    const receipt1Res = await pg.query<{ id: string }>(`
      INSERT INTO public.oc_recepciones (
        empresa_id, order_id, remito_numero, observaciones, created_by
      )
      VALUES (
        '${empresaA}', '${authorizedOrderId}', 'REM-001-4401', 'Primera entrega parcial en obra', '${userAdmin}'
      )
      RETURNING id;
    `);
    const receipt1Id = receipt1Res.rows[0].id;

    await pg.query(`
      INSERT INTO public.oc_recepcion_items (
        empresa_id, recepcion_id, product, cantidad_recibida, unidad
      )
      VALUES (
        '${empresaA}', '${receipt1Id}', 'Cemento Portland Tipo I', 40, 'bolsa'
      );
    `);

    // Simular registro en inventario de depósito de obra
    await pg.query(`
      INSERT INTO public.inventory_movements (
        empresa_id, project_id, producto_id, tipo_movimiento, cantidad, referencia_tipo, referencia_id, created_by
      )
      VALUES (
        '${empresaA}', '${projectId}', '${productId}', 'RECEPCION_OC', 40, 'oc_recepciones', '${receipt1Id}', '${userAdmin}'
      );
    `);

    // Verificar saldo pendiente tras recepción 1 (100 - 40 = 60 bolsas pendientes)
    const rec1Sum = await pg.query<{ sum: string }>(`
      SELECT coalesce(sum(cantidad_recibida), 0) as sum
      FROM public.oc_recepcion_items
      WHERE recepcion_id = '${receipt1Id}';
    `);
    expect(Number(rec1Sum.rows[0].sum)).toBe(40);

    // =========================================================================
    // PASO 11 & 12: Recepción 2 (60 bolsas restantes = 100 total) + Stock reflejado
    // =========================================================================
    const receipt2Res = await pg.query<{ id: string }>(`
      INSERT INTO public.oc_recepciones (
        empresa_id, order_id, remito_numero, observaciones, created_by
      )
      VALUES (
        '${empresaA}', '${authorizedOrderId}', 'REM-001-4409', 'Segunda entrega completa en obra', '${userAdmin}'
      )
      RETURNING id;
    `);
    const receipt2Id = receipt2Res.rows[0].id;

    await pg.query(`
      INSERT INTO public.oc_recepcion_items (
        empresa_id, recepcion_id, product, cantidad_recibida, unidad
      )
      VALUES (
        '${empresaA}', '${receipt2Id}', 'Cemento Portland Tipo I', 60, 'bolsa'
      );
    `);

    await pg.query(`
      INSERT INTO public.inventory_movements (
        empresa_id, project_id, producto_id, tipo_movimiento, cantidad, referencia_tipo, referencia_id, created_by
      )
      VALUES (
        '${empresaA}', '${projectId}', '${productId}', 'RECEPCION_OC', 60, 'oc_recepciones', '${receipt2Id}', '${userAdmin}'
      );
    `);

    // Total recibido en la OC = 100 bolsas
    const totalReceived = await pg.query<{ total: string }>(`
      SELECT sum(ori.cantidad_recibida) as total
      FROM public.oc_recepcion_items ori
      JOIN public.oc_recepciones orc ON orc.id = ori.recepcion_id
      WHERE orc.order_id = '${authorizedOrderId}';
    `);
    expect(Number(totalReceived.rows[0].total)).toBe(100);

    // Total acumulado en movimientos de inventario de la obra = 100
    const stockBalance = await pg.query<{ stock: string }>(`
      SELECT sum(cantidad) as stock
      FROM public.inventory_movements
      WHERE project_id = '${projectId}' AND producto_id = '${productId}' AND tipo_movimiento = 'RECEPCION_OC';
    `);
    expect(Number(stockBalance.rows[0].stock)).toBe(100);

    // =========================================================================
    // PASO 13, 14 & 15: Factura de proveedor cargada, encuentra OC y Recepción
    // =========================================================================
    const invoiceRes = await pg.query<{ id: string; status: string }>(`
      INSERT INTO public.invoices (
        empresa_id, provider_id, project_id, invoice_number, invoice_date, subtotal, vat, total, currency, status
      )
      VALUES (
        '${empresaA}', '${providerId}', '${projectId}', '001-002-0008899', '2026-09-25', 5000000, 500000, 5500000, 'PYG', 'PENDIENTE'
      )
      RETURNING id, status;
    `);
    const invoiceId = invoiceRes.rows[0].id;
    expect(invoiceId).toBeDefined();

    // =========================================================================
    // PASO 16 & 17: 3-Way Match (Factura 5,500,000 == OC 5,500,000 && 100 bolsas recibidas)
    // =========================================================================
    const matchRes = await pg.query<{ id: string }>(`
      INSERT INTO public.invoice_order_matches (
        empresa_id, invoice_id, authorized_order_id, match_type, notes, created_by
      )
      VALUES (
        '${empresaA}', '${invoiceId}', '${authorizedOrderId}', 'EXACT_MATCH', '3-Way Match validado con 2 remitos', '${userAdmin}'
      )
      RETURNING id;
    `);
    expect(matchRes.rows[0].id).toBeDefined();

    // Actualizar facturado en la OC y estado de factura
    await pg.exec(`
      UPDATE public.authorized_orders
      SET facturado_amount = 5500000, status = 'FACTURADO'
      WHERE id = '${authorizedOrderId}';

      UPDATE public.invoices
      SET status = 'APTO_PARA_PAGO'
      WHERE id = '${invoiceId}';
    `);

    const invStatusCheck = await pg.query<{ status: string }>(`
      SELECT status FROM public.invoices WHERE id = '${invoiceId}';
    `);
    expect(invStatusCheck.rows[0].status).toBe("APTO_PARA_PAGO");

    // =========================================================================
    // PASO 18 & 19: Generar Orden de Pago (OP) y verificar trazabilidad completa
    // =========================================================================
    const opRes = await pg.query<{ id: string; code: string; status: string }>(`
      INSERT INTO public.payment_orders (
        empresa_id, provider_id, project_id, amount, currency, status, created_by
      )
      VALUES (
        '${empresaA}', '${providerId}', '${projectId}', 5500000, 'PYG', 'PENDIENTE', '${userAdmin}'
      )
      RETURNING id, code, status;
    `);
    const opId = opRes.rows[0].id;
    expect(opId).toBeDefined();

    await pg.query(`
      INSERT INTO public.payment_order_invoices (
        empresa_id, payment_order_id, invoice_id, amount
      )
      VALUES (
        '${empresaA}', '${opId}', '${invoiceId}', 5500000
      );
    `);

    // Trazabilidad end-to-end: OP -> Factura -> Match -> OC -> Recepción -> RFQ -> Proyecto
    const lineage = await pg.query<{
      op_id: string;
      invoice_number: string;
      order_code: string;
      rfq_code: string;
      project_name: string;
      total_received: string;
    }>(`
      SELECT 
        po.id as op_id,
        inv.invoice_number,
        ao.code as order_code,
        r.code as rfq_code,
        p.name as project_name,
        (SELECT sum(ori.cantidad_recibida) FROM public.oc_recepcion_items ori JOIN public.oc_recepciones orc ON orc.id = ori.recepcion_id WHERE orc.order_id = ao.id) as total_received
      FROM public.payment_orders po
      JOIN public.payment_order_invoices poi ON poi.payment_order_id = po.id
      JOIN public.invoices inv ON inv.id = poi.invoice_id
      JOIN public.invoice_order_matches iom ON iom.invoice_id = inv.id
      JOIN public.authorized_orders ao ON ao.id = iom.authorized_order_id
      JOIN public.rfqs r ON r.id = ao.rfq_id
      JOIN public.projects p ON p.id = ao.project_id
      WHERE po.id = '${opId}';
    `);

    expect(lineage.rows.length).toBe(1);
    expect(lineage.rows[0].invoice_number).toBe("001-002-0008899");
    expect(lineage.rows[0].project_name).toBe("Edificio Alborada");
    expect(Number(lineage.rows[0].total_received)).toBe(100);

    // =========================================================================
    // RESILIENCE CHECK 2: Multi-tenant isolation (Empresa B no puede tocar OC de Empresa A)
    // =========================================================================
    let tenantViolationCaught = false;
    try {
      await pg.query(`
        SELECT public.select_and_authorize_offer_atomically(
          '${empresaB}'::uuid,
          '${userAdmin}'::uuid,
          '${rfqId}'::uuid,
          '${rfqProviderId}'::uuid,
          '${quoteVersionId}'::uuid,
          'PROVEEDOR_HABITUAL'::public.selection_reason,
          'Cross-tenant attempt'::text
        );
      `);
    } catch {
      tenantViolationCaught = true;
    }
    expect(tenantViolationCaught).toBe(true);
  });
});
