-- El job de avisos del calendario (service_role) lee cursos para armar el texto.
GRANT SELECT ON public.cursos TO service_role;
GRANT SELECT ON public.eventos_academicos TO service_role;
GRANT SELECT ON public.salidas TO service_role;
