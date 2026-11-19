-- Permite avisar al docente cuando el administrador responde una consulta.
-- El valor NOW() evita marcar como no leídas las consultas existentes.
BEGIN;

ALTER TABLE public.mensajes_docente_admin
  ADD COLUMN IF NOT EXISTS leido_por_docente_at timestamptz DEFAULT now();

COMMIT;
