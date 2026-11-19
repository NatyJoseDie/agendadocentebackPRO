BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON TABLE public.mensajes_docente_admin TO service_role;
GRANT ALL ON TABLE public.mensajes_docente_admin_respuestas TO service_role;

COMMIT;
