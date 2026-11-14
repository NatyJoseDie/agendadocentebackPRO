BEGIN;

-- Corrige la lógica de activación de pago para aceptar:
-- - plan basico
-- - ciclo lectivo
-- - fechas exactas de expiración
-- - validación real del pago sin depender de valores rígidos de 30/365 días

CREATE OR REPLACE FUNCTION public.activar_pago_suscripcion(
  p_docente_id uuid,
  p_payment_id text,
  p_monto numeric,
  p_moneda text,
  p_estado text,
  p_metodo_pago text,
  p_plan text,
  p_ciclo text,
  p_fecha_pago timestamptz,
  p_dias integer,
  p_expira_at timestamptz DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan text;
  v_subscription_plan text;
  v_vencimiento_actual timestamptz;
  v_vencimiento_pago timestamptz;
  v_docente_pago_id uuid;
  v_pago_existente boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Solo el backend puede activar pagos.'
      USING ERRCODE = '42501';
  END IF;

  IF p_docente_id IS NULL
    OR p_payment_id IS NULL
    OR p_payment_id = ''
    OR p_estado IS DISTINCT FROM 'approved'
    OR p_moneda IS DISTINCT FROM 'ARS'
    OR p_plan IS NULL
    OR p_plan NOT IN ('basico', 'pro', 'premium')
    OR p_ciclo IS NULL
    OR p_ciclo NOT IN ('mensual', 'ciclo_lectivo')
    OR p_dias IS NULL
    OR p_dias <= 0
    OR p_monto IS NULL
    OR p_monto <= 0
    OR p_fecha_pago IS NULL
  THEN
    RAISE EXCEPTION 'Los datos del pago no son válidos.'
      USING ERRCODE = '22023';
  END IF;

  SELECT d.plan, d.subscription_plan, d.trial_ends_at
    INTO v_plan, v_subscription_plan, v_vencimiento_actual
  FROM public.docentes AS d
  WHERE d.id = p_docente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el docente del pago.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT p.docente_id, p.expira_at
    INTO v_docente_pago_id, v_vencimiento_pago
  FROM public.pagos AS p
  WHERE p.mp_payment_id = p_payment_id;

  v_pago_existente := FOUND;
  IF v_pago_existente AND v_docente_pago_id <> p_docente_id THEN
    RAISE EXCEPTION 'El pago ya está asociado a otro docente.'
      USING ERRCODE = '23505';
  END IF;

  IF v_vencimiento_pago IS NULL THEN
    v_vencimiento_pago := COALESCE(
      p_expira_at,
      GREATEST(
        COALESCE(v_vencimiento_actual, p_fecha_pago),
        p_fecha_pago
      ) + (p_dias * INTERVAL '1 day')
    );
  END IF;

  IF NOT v_pago_existente THEN
    INSERT INTO public.pagos (
      docente_id,
      mp_payment_id,
      monto,
      moneda,
      estado,
      metodo_pago,
      plan,
      fecha_pago,
      expira_at
    ) VALUES (
      p_docente_id,
      p_payment_id,
      p_monto,
      p_moneda,
      p_estado,
      p_metodo_pago,
      p_plan,
      p_fecha_pago,
      v_vencimiento_pago
    )
    ON CONFLICT (mp_payment_id) DO NOTHING;

    SELECT p.docente_id, p.expira_at
      INTO v_docente_pago_id, v_vencimiento_pago
    FROM public.pagos AS p
    WHERE p.mp_payment_id = p_payment_id;

    IF v_docente_pago_id <> p_docente_id THEN
      RAISE EXCEPTION 'El pago ya está asociado a otro docente.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Si el docente tiene un plan pago vigente y el nuevo vencimiento no mejora el actual,
  -- se conserva el vencimiento más largo que ya tenía.
  IF v_vencimiento_actual IS NOT NULL AND v_vencimiento_actual >= v_vencimiento_pago THEN
    RETURN v_vencimiento_actual;
  END IF;

  UPDATE public.docentes
  SET plan = p_plan,
      subscription_plan = p_plan,
      is_premium = (p_plan IN ('pro', 'premium')),
      is_vip_beta = FALSE,
      trial_ends_at = v_vencimiento_pago,
      updated_at = statement_timestamp()
  WHERE id = p_docente_id;

  RETURN v_vencimiento_pago;
END;
$$;

REVOKE ALL ON FUNCTION public.activar_pago_suscripcion(
  uuid, text, numeric, text, text, text, text, text, timestamptz, integer, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activar_pago_suscripcion(
  uuid, text, numeric, text, text, text, text, text, timestamptz, integer, timestamptz
) TO service_role;

COMMIT;
