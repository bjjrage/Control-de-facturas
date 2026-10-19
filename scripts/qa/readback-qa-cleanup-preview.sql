SELECT
  (SELECT count(*) FROM public.empresas WHERE slug LIKE 'qa-isolated-%') AS qa_companies,
  (SELECT count(*) FROM public.invoices i JOIN public.empresas e ON e.id=i.empresa_id
   WHERE e.slug LIKE 'qa-isolated-%') AS qa_invoices,
  (SELECT count(*) FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
   WHERE e.slug LIKE 'qa-isolated-%') AS qa_profiles;
