-- Mensajes internos del administrador a docentes (individuales o masivos),
-- con respuestas de los docentes. Solo accesibles vía backend (service role).

BEGIN;

CREATE TABLE IF NOT EXISTS public.mensajes_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL DEFAULT 'aviso' CHECK (tipo IN ('aviso', 'oferta', 'plan', 'personal')),
  titulo text NOT NULL,
  cuerpo text NOT NULL,
  alcance text NOT NULL DEFAULT 'todos',
  created_by uuid REFERENCES public.docentes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mensajes_admin_destinatarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mensaje_id uuid NOT NULL REFERENCES public.mensajes_admin(id) ON DELETE CASCADE,
  docente_id uuid NOT NULL REFERENCES public.docentes(id) ON DELETE CASCADE,
  leida_at timestamptz,
  ultima_actividad_at timestamptz NOT NULL DEFAULT now(),
  admin_leyo_respuestas_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mensaje_id, docente_id)
);

CREATE TABLE IF NOT EXISTS public.mensajes_admin_respuestas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destinatario_id uuid NOT NULL REFERENCES public.mensajes_admin_destinatarios(id) ON DELETE CASCADE,
  autor text NOT NULL CHECK (autor IN ('docente', 'admin')),
  cuerpo text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mensajes_dest_docente_idx
  ON public.mensajes_admin_destinatarios (docente_id, ultima_actividad_at DESC);
CREATE INDEX IF NOT EXISTS mensajes_dest_noleidos_idx
  ON public.mensajes_admin_destinatarios (docente_id) WHERE leida_at IS NULL;
CREATE INDEX IF NOT EXISTS mensajes_resp_dest_idx
  ON public.mensajes_admin_respuestas (destinatario_id, created_at);

ALTER TABLE public.mensajes_admin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_admin_destinatarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_admin_respuestas ENABLE ROW LEVEL SECURITY;

COMMIT;
