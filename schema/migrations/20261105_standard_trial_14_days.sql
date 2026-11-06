-- Asigna una prueba Pro de 14 días a perfiles nuevos que no sean VIP beta
-- ni cuentas administrativas. No modifica perfiles existentes.

CREATE OR REPLACE FUNCTION public.iniciar_prueba_estandar_docente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT COALESCE(NEW.is_vip_beta, FALSE)
    AND NEW.trial_ends_at IS NULL
    AND COALESCE(NEW.plan, 'gratuito') = 'gratuito'
    AND COALESCE(NEW.subscription_plan, 'free') = 'free'
    AND NOT COALESCE(NEW.is_premium, FALSE)
    AND lower(COALESCE(NEW.email, '')) NOT IN (
      'nbarzotti6@gmail.com',
      'natalia@agendadocente.com',
      'admin@agendadocente.com'
    )
  THEN
    NEW.plan := 'pro';
    NEW.subscription_plan := 'pro';
    NEW.is_premium := FALSE;
    NEW.trial_ends_at := statement_timestamp() + INTERVAL '14 days';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS docentes_asignar_prueba_estandar ON public.docentes;
CREATE TRIGGER docentes_asignar_prueba_estandar
  BEFORE INSERT ON public.docentes
  FOR EACH ROW
  EXECUTE FUNCTION public.iniciar_prueba_estandar_docente();
