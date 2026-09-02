-- Reset de contadores de código tras limpiar los casos demo.
-- Pegar en el SQL Editor de Supabase (proyecto "Control facturas") y ejecutar.
-- Deja el próximo RFQ en RFQ-2025-0001 y la próxima OC manual en OC-2025-0001.

select setval('public.rfq_code_seq', 1, false);
select setval('public.order_code_seq', 1, false);
