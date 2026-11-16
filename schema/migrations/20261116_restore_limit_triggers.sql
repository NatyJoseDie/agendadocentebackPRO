-- Restaura los triggers de límites por plan (se perdieron con DROP FUNCTION ... CASCADE
-- en 20261112), elimina los triggers viejos que bloqueaban a la fundadora y
-- hace que is_admin / is_vip_beta no tengan límites.

BEGIN;

-- 1. Triggers y funciones viejas (límites fijos, sin excepción de fundadora)
DROP TRIGGER IF EXISTS tr_check_limite_escuelas ON public.escuelas;
DROP TRIGGER IF EXISTS trigger_check_limite_escuelas ON public.escuelas;
DROP TRIGGER IF EXISTS tr_check_limite_cursos ON public.cursos;
DROP TRIGGER IF EXISTS trigger_check_limite_cursos ON public.cursos;
DROP FUNCTION IF EXISTS public.fn_validar_limites_agenda() CASCADE;
DROP FUNCTION IF EXISTS public.check_limite_escuelas() CASCADE;

-- 2. Función vigente, con bypass para admin
CREATE OR REPLACE FUNCTION public.limitar_altas_plan_gratuito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan TEXT;
  v_subscription_plan TEXT;
  v_trial_ends_at TIMESTAMPTZ;
  v_requerida BOOLEAN;
  v_email TEXT;
  v_total BIGINT;
  v_limite_escuelas INTEGER;
  v_limite_cursos INTEGER;
  v_is_vip_beta BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.docente_id::TEXT || ':' || TG_TABLE_NAME, 0));

  SELECT plan, subscription_plan, trial_ends_at,
         free_plan_selection_required, email,
         coalesce(is_vip_beta, FALSE), coalesce(is_admin, FALSE)
    INTO v_plan, v_subscription_plan, v_trial_ends_at, v_requerida, v_email,
         v_is_vip_beta, v_is_admin
  FROM public.docentes
  WHERE id = NEW.docente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil docente.';
  END IF;

  IF v_is_admin OR lower(coalesce(v_email, '')) IN (
    'nbarzotti6@gmail.com',
    'natalia@agendadocente.com',
    'admin@agendadocente.com'
  ) THEN
    RETURN NEW;
  END IF;

  IF (v_plan IN ('pro', 'premium', 'basico') OR v_subscription_plan IN ('pro', 'premium', 'basico'))
    AND (v_trial_ends_at IS NULL OR v_trial_ends_at > statement_timestamp())
  THEN
    IF v_is_vip_beta OR v_plan = 'premium' OR v_subscription_plan = 'premium' THEN
      RETURN NEW;
    END IF;

    IF v_plan = 'basico' OR v_subscription_plan = 'basico' THEN
      v_limite_escuelas := 3;
      v_limite_cursos := 5;
    ELSE
      v_limite_escuelas := 6;
      v_limite_cursos := 10;
    END IF;

    IF TG_TABLE_NAME = 'escuelas' THEN
      SELECT count(*) INTO v_total FROM public.escuelas
      WHERE docente_id = NEW.docente_id AND activo IS TRUE;
      IF v_total >= v_limite_escuelas THEN
        RAISE EXCEPTION 'El Plan % permite hasta % escuelas.',
          CASE WHEN v_plan = 'basico' OR v_subscription_plan = 'basico' THEN 'BÁSICO' ELSE 'PRO' END,
          v_limite_escuelas
          USING ERRCODE = '42501';
      END IF;
    ELSE
      SELECT count(*) INTO v_total FROM public.cursos
      WHERE docente_id = NEW.docente_id AND activo IS TRUE;
      IF v_total >= v_limite_cursos THEN
        RAISE EXCEPTION 'El Plan % permite hasta % cursos.',
          CASE WHEN v_plan = 'basico' OR v_subscription_plan = 'basico' THEN 'BÁSICO' ELSE 'PRO' END,
          v_limite_cursos
          USING ERRCODE = '42501';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF v_requerida THEN
    RAISE EXCEPTION 'Elegí los recursos del Plan Gratuito antes de crear nuevos.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'escuelas' THEN
    SELECT count(*) INTO v_total FROM public.escuelas
    WHERE docente_id = NEW.docente_id AND activo IS TRUE;
    IF v_total >= 1 THEN
      RAISE EXCEPTION 'El Plan Gratuito permite hasta 1 escuela.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT count(*) INTO v_total FROM public.cursos
    WHERE docente_id = NEW.docente_id AND activo IS TRUE;
    IF v_total >= 2 THEN
      RAISE EXCEPTION 'El Plan Gratuito permite hasta 2 cursos.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Triggers de alta
DROP TRIGGER IF EXISTS limitar_altas_escuelas_plan_gratuito ON public.escuelas;
CREATE TRIGGER limitar_altas_escuelas_plan_gratuito
  BEFORE INSERT ON public.escuelas
  FOR EACH ROW EXECUTE FUNCTION public.limitar_altas_plan_gratuito();

DROP TRIGGER IF EXISTS limitar_altas_cursos_plan_gratuito ON public.cursos;
CREATE TRIGGER limitar_altas_cursos_plan_gratuito
  BEFORE INSERT ON public.cursos
  FOR EACH ROW EXECUTE FUNCTION public.limitar_altas_plan_gratuito();

-- 4. Fundadora: todo libre
UPDATE public.docentes
SET is_admin = TRUE
WHERE lower(email) IN ('nbarzotti6@gmail.com', 'natalia@agendadocente.com', 'admin@agendadocente.com');

COMMIT;
