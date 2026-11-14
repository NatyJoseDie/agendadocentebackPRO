-- Plan Básico: 3 escuelas, 5 cursos, sin OCR
-- Precio mensual: $1.500 (promo $1.200), ciclo lectivo: $12.000 (promo $9.000)
-- Promo hasta 29/04/2027

BEGIN;

-- 1. Ampliar CHECK de planes_precios para permitir 'basico'
ALTER TABLE public.planes_precios
  DROP CONSTRAINT IF EXISTS planes_precios_plan_check,
  ADD CONSTRAINT planes_precios_plan_check
    CHECK (plan IN ('pro', 'premium', 'basico'));

ALTER TABLE public.planes_precios
  DROP CONSTRAINT IF EXISTS planes_precios_id_check,
  ADD CONSTRAINT planes_precios_id_check
    CHECK (id IN (
      'pro_mensual', 'pro_ciclo_lectivo',
      'premium_mensual', 'premium_ciclo_lectivo',
      'basico_mensual', 'basico_ciclo_lectivo'
    ));

-- 2. Insertar planes Básico
INSERT INTO public.planes_precios (id, plan, ciclo, titulo, precio, precio_promocional, promo_hasta)
VALUES
  ('basico_mensual', 'basico', 'mensual', 'Agenda Docente - Plan BÁSICO (Mensual)', 1500, 1200, '2027-04-29 23:59:59-03'),
  ('basico_ciclo_lectivo', 'basico', 'ciclo_lectivo', 'Agenda Docente - Plan BÁSICO (Ciclo lectivo)', 12000, 9000, '2027-04-29 23:59:59-03')
ON CONFLICT (id) DO NOTHING;

-- 3. Actualizar trigger limitar_altas_plan_gratuito para incluir plan 'basico'
DROP FUNCTION IF EXISTS public.limitar_altas_plan_gratuito() CASCADE;

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
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.docente_id::TEXT || ':' || TG_TABLE_NAME, 0));

  SELECT plan, subscription_plan, trial_ends_at,
         free_plan_selection_required, email, coalesce(is_vip_beta, FALSE)
    INTO v_plan, v_subscription_plan, v_trial_ends_at, v_requerida, v_email, v_is_vip_beta
  FROM public.docentes
  WHERE id = NEW.docente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil docente.';
  END IF;

  IF lower(coalesce(v_email, '')) IN (
    'nbarzotti6@gmail.com',
    'natalia@agendadocente.com',
    'admin@agendadocente.com'
  ) THEN
    RETURN NEW;
  END IF;

  -- Planes pagos vigentes (incluye VIP y Básico)
  IF (v_plan IN ('pro', 'premium', 'basico') OR v_subscription_plan IN ('pro', 'premium', 'basico'))
    AND (v_trial_ends_at IS NULL OR v_trial_ends_at > statement_timestamp())
  THEN
    IF v_is_vip_beta OR v_plan = 'premium' OR v_subscription_plan = 'premium' THEN
      RETURN NEW; -- Premium y VIP: sin límites
    END IF;

    -- Límites por plan
    IF v_plan = 'basico' OR v_subscription_plan = 'basico' THEN
      v_limite_escuelas := 3;
      v_limite_cursos := 5;
    ELSE
      v_limite_escuelas := 6; -- PRO
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

  -- Plan Gratuito o vencido
  IF v_requerida THEN
    RAISE EXCEPTION 'Elegí los recursos del Plan Gratuito antes de crear nuevos.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'escuelas' THEN
    v_limite_escuelas := 1;
    SELECT count(*) INTO v_total FROM public.escuelas
    WHERE docente_id = NEW.docente_id AND activo IS TRUE;
    IF v_total >= v_limite_escuelas THEN
      RAISE EXCEPTION 'El Plan Gratuito permite hasta % escuela.', v_limite_escuelas
        USING ERRCODE = '42501';
    END IF;
  ELSE
    v_limite_cursos := 2;
    SELECT count(*) INTO v_total FROM public.cursos
    WHERE docente_id = NEW.docente_id AND activo IS TRUE;
    IF v_total >= v_limite_cursos THEN
      RAISE EXCEPTION 'El Plan Gratuito permite hasta % cursos.', v_limite_cursos
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;