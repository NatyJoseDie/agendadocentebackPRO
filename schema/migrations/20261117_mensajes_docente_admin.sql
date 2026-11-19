-- Mensajes que envía un docente al administrador.
-- Soporta un hilo con respuestas de administración y docente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mensajes_docente_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  docente_id uuid NOT NULL REFERENCES public.docentes(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  cuerpo text NOT NULL,
  estado text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'respondido', 'cerrado')),
  leido_por_admin_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mensajes_docente_admin_respuestas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensaje_id uuid NOT NULL REFERENCES public.mensajes_docente_admin(id) ON DELETE CASCADE,
  autor text NOT NULL CHECK (autor IN ('docente', 'admin')),
  cuerpo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mensajes_docente_admin_docente_idx
  ON public.mensajes_docente_admin (docente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mensajes_docente_admin_respuestas_idx
  ON public.mensajes_docente_admin_respuestas (mensaje_id, created_at);

ALTER TABLE public.mensajes_docente_admin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_docente_admin_respuestas ENABLE ROW LEVEL SECURITY;

COMMIT;
