BEGIN;

ALTER TABLE public.docentes
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.docentes
SET is_admin = TRUE
WHERE lower(email) IN (
  'nbarzotti6@gmail.com',
  'natalia@agendadocente.com',
  'admin@agendadocente.com'
);

COMMIT;
