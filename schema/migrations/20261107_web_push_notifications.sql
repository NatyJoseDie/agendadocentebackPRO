-- Configura suscripciones Web Push y una cola de entregas por dispositivo.
-- Ejecutar una sola vez en Supabase antes de habilitar push en Render.

BEGIN;

ALTER TABLE public.notificaciones_docente
  ADD COLUMN IF NOT EXISTS push_estado TEXT NOT NULL DEFAULT 'omitida'
    CHECK (push_estado IN ('pendiente', 'enviada', 'fallida', 'sin_suscripciones', 'omitida')),
  ADD COLUMN IF NOT EXISTS push_enqueued_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.push_suscripciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  docente_id UUID NOT NULL REFERENCES public.docentes(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE
    CHECK (endpoint LIKE 'https://%' AND octet_length(endpoint) <= 2048),
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  expiration_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_suscripciones_docente_idx
  ON public.push_suscripciones (docente_id);

ALTER TABLE public.push_suscripciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_suscripciones FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.push_suscripciones TO service_role;

CREATE TABLE IF NOT EXISTS public.notificaciones_push_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacion_id UUID NOT NULL
    REFERENCES public.notificaciones_docente(id) ON DELETE CASCADE,
  suscripcion_id UUID
    REFERENCES public.push_suscripciones(id) ON DELETE SET NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'enviando', 'fallida', 'enviada', 'expirada')),
  intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento_at TIMESTAMPTZ DEFAULT NOW(),
  ultimo_intento_at TIMESTAMPTZ,
  enviada_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (notificacion_id, suscripcion_id)
);

CREATE INDEX IF NOT EXISTS notificaciones_push_envios_pendientes_idx
  ON public.notificaciones_push_envios (proximo_intento_at)
  WHERE estado IN ('pendiente', 'fallida');

ALTER TABLE public.notificaciones_push_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones_push_envios FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notificaciones_push_envios TO service_role;

COMMIT;
