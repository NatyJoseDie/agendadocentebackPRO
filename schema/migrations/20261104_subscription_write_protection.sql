-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Conserva el acceso de lectura y bloquea escrituras directas durante la gracia.

BEGIN;

ALTER TABLE public.docentes
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_vip_beta BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

ALTER TABLE public.docentes
  ALTER COLUMN subscription_plan SET DEFAULT 'free',
  ALTER COLUMN is_premium SET DEFAULT FALSE;

DO $constraints$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.docentes'::regclass
      AND contype = 'c'
      AND (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.docentes'::regclass
          AND attname = 'plan'
      ) = ANY(conkey)
  LOOP
    EXECUTE format('ALTER TABLE public.docentes DROP CONSTRAINT %I', constraint_record.conname);
  END LOOP;
END;
$constraints$;

UPDATE public.docentes
SET plan = 'gratuito'
WHERE plan = 'free';

ALTER TABLE public.docentes
  ADD CONSTRAINT docentes_plan_check CHECK (plan IN ('gratuito', 'pro', 'premium'));

UPDATE public.docentes
SET subscription_plan = CASE
  WHEN plan IN ('pro', 'premium') THEN plan
  ELSE 'free'
END,
is_premium = coalesce(plan IN ('pro', 'premium'), FALSE)
WHERE subscription_plan IS NULL
  OR (plan IN ('pro', 'premium') AND subscription_plan NOT IN ('pro', 'premium'))
  OR is_premium IS NULL
  OR (plan IN ('pro', 'premium') AND is_premium IS FALSE);

UPDATE public.docentes
SET is_vip_beta = TRUE
WHERE is_vip_beta IS FALSE
  AND (plan IN ('pro', 'premium') OR subscription_plan IN ('pro', 'premium'))
  AND coalesce(lower(email), '') NOT IN (
    'nbarzotti6@gmail.com',
    'natalia@agendadocente.com',
    'admin@agendadocente.com'
  )
  AND created_at IS NOT NULL
  AND trial_ends_at BETWEEN created_at + INTERVAL '119 days'
                        AND created_at + INTERVAL '121 days';

DO $payment_index$
DECLARE
  payment_id_attribute smallint;
BEGIN
  SELECT attnum
    INTO payment_id_attribute
  FROM pg_attribute
  WHERE attrelid = 'public.pagos'::regclass
    AND attname = 'mp_payment_id'
    AND NOT attisdropped;

  IF payment_id_attribute IS NULL THEN
    RAISE EXCEPTION 'Falta la columna pagos.mp_payment_id.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.pagos'::regclass
      AND contype = 'u'
      AND conkey = ARRAY[payment_id_attribute]
  ) THEN
    ALTER TABLE public.pagos
      ADD CONSTRAINT pagos_mp_payment_id_unique UNIQUE (mp_payment_id);
  END IF;
END;
$payment_index$;

CREATE OR REPLACE FUNCTION public.docente_puede_escribir(p_docente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (p_docente_id = auth.uid() OR coalesce(auth.role(), '') = 'service_role')
    AND EXISTS (
      SELECT 1
      FROM public.docentes AS d
      WHERE d.id = p_docente_id
        AND NOT (
          (
            coalesce(d.plan, '') IN ('pro', 'premium')
            OR coalesce(d.subscription_plan, '') IN ('pro', 'premium')
          )
          AND d.trial_ends_at IS NOT NULL
          AND d.trial_ends_at <= statement_timestamp()
          AND d.trial_ends_at > statement_timestamp() - INTERVAL '30 days'
        )
    );
$$;

REVOKE ALL ON FUNCTION public.docente_puede_escribir(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.docente_puede_escribir(uuid) TO authenticated, service_role;

ALTER TABLE public.docentes ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE ON public.docentes FROM PUBLIC, anon, authenticated;
GRANT INSERT (id, email, nombre, apellido, avatar_url, rol, escuela, provincia, turno)
  ON public.docentes TO authenticated;
GRANT UPDATE (nombre, apellido, escuela, provincia, turno, updated_at)
  ON public.docentes TO authenticated;

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
  p_dias integer
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
    OR p_plan NOT IN ('pro', 'premium')
    OR p_ciclo IS NULL
    OR p_ciclo NOT IN ('mensual', 'anual')
    OR p_dias IS DISTINCT FROM (
      CASE WHEN p_ciclo = 'mensual' THEN 30 ELSE 365 END
    )
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

  IF NOT v_pago_existente OR v_vencimiento_pago IS NULL THEN
    v_vencimiento_pago := greatest(
      coalesce(v_vencimiento_actual, p_fecha_pago),
      p_fecha_pago
    ) + p_dias * INTERVAL '1 day';

    IF v_pago_existente THEN
      UPDATE public.pagos
      SET expira_at = v_vencimiento_pago
      WHERE mp_payment_id = p_payment_id;
    ELSE
      INSERT INTO public.pagos (
        docente_id, mp_payment_id, monto, moneda, estado, metodo_pago,
        plan, fecha_pago, expira_at
      ) VALUES (
        p_docente_id, p_payment_id, p_monto, p_moneda, p_estado, p_metodo_pago,
        p_plan || '_' || p_ciclo, p_fecha_pago, v_vencimiento_pago
      )
      ON CONFLICT (mp_payment_id) DO NOTHING;

      IF NOT FOUND THEN
        SELECT p.docente_id, p.expira_at
          INTO v_docente_pago_id, v_vencimiento_pago
        FROM public.pagos AS p
        WHERE p.mp_payment_id = p_payment_id;

        IF v_docente_pago_id <> p_docente_id THEN
          RAISE EXCEPTION 'El pago ya está asociado a otro docente.'
            USING ERRCODE = '23505';
        END IF;

        v_pago_existente := TRUE;
        IF v_vencimiento_pago IS NULL THEN
          UPDATE public.pagos
          SET expira_at = greatest(
            coalesce(v_vencimiento_actual, p_fecha_pago),
            p_fecha_pago
          ) + p_dias * INTERVAL '1 day'
          WHERE mp_payment_id = p_payment_id
          RETURNING expira_at INTO v_vencimiento_pago;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_vencimiento_actual IS NULL
    AND (
      v_plan IN ('pro', 'premium')
      OR v_subscription_plan IN ('pro', 'premium')
    )
  THEN
    RETURN NULL;
  END IF;

  IF v_pago_existente AND v_vencimiento_actual >= v_vencimiento_pago THEN
    RETURN v_vencimiento_actual;
  END IF;

  IF v_vencimiento_actual IS NULL OR v_vencimiento_actual < v_vencimiento_pago THEN
    UPDATE public.docentes
    SET plan = p_plan,
        subscription_plan = p_plan,
        is_premium = TRUE,
        is_vip_beta = FALSE,
        trial_ends_at = v_vencimiento_pago,
        updated_at = statement_timestamp()
    WHERE id = p_docente_id;
  END IF;

  RETURN v_vencimiento_pago;
END;
$$;

REVOKE ALL ON FUNCTION public.activar_pago_suscripcion(
  uuid, text, numeric, text, text, text, text, text, timestamptz, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activar_pago_suscripcion(
  uuid, text, numeric, text, text, text, text, text, timestamptz, integer
) TO service_role;

CREATE TABLE IF NOT EXISTS public.notificaciones_docente (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id UUID REFERENCES public.docentes(id) ON DELETE CASCADE NOT NULL,
  event_key TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  programada_para TIMESTAMPTZ NOT NULL,
  leida_at TIMESTAMPTZ,
  email_estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (email_estado IN ('pendiente', 'enviando', 'fallida', 'enviada')),
  email_intentos INTEGER NOT NULL DEFAULT 0 CHECK (email_intentos >= 0),
  email_ultimo_intento_at TIMESTAMPTZ,
  email_enviada_at TIMESTAMPTZ,
  email_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.notificaciones_docente ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificaciones_docente FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notificaciones_docente TO service_role;
GRANT SELECT ON public.notificaciones_docente TO authenticated;
GRANT UPDATE (leida_at) ON public.notificaciones_docente TO authenticated;

DROP POLICY IF EXISTS notificaciones_select_own ON public.notificaciones_docente;
CREATE POLICY notificaciones_select_own ON public.notificaciones_docente
  FOR SELECT USING (auth.uid() = docente_id);
DROP POLICY IF EXISTS notificaciones_update_read_own ON public.notificaciones_docente;
CREATE POLICY notificaciones_update_read_own ON public.notificaciones_docente
  FOR UPDATE USING (auth.uid() = docente_id)
  WITH CHECK (auth.uid() = docente_id);

DROP POLICY IF EXISTS docentes_update_own ON public.docentes;
CREATE POLICY docentes_update_own ON public.docentes
  FOR UPDATE
  USING (auth.uid() = id AND public.docente_puede_escribir(id))
  WITH CHECK (auth.uid() = id AND public.docente_puede_escribir(id));

DO $policies$
DECLARE
  policy_record record;
  existing_policy record;
BEGIN
  FOR policy_record IN
    SELECT table_name
    FROM (VALUES
      ('escuelas'),
      ('cursos'),
      ('horarios_curso'),
      ('alumnos'),
      ('asistencias'),
      ('calificaciones'),
      ('planificaciones'),
      ('contactos'),
      ('calendario'),
      ('eventos_academicos'),
      ('proyectos'),
      ('salidas'),
      ('salidas_educativas'),
      ('condiciones_especiales'),
      ('comunicaciones'),
      ('intensificaciones'),
      ('libro_temas'),
      ('licencias'),
      ('planilla_oficial'),
      ('seguimiento_diario'),
      ('copias_seguridad')
    ) AS policies(table_name)
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', policy_record.table_name);
    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_record.table_name
    LOOP
      EXECUTE format(
        'DROP POLICY %I ON public.%I',
        existing_policy.policyname,
        policy_record.table_name
      );
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() = docente_id)',
      'agenda_' || policy_record.table_name || '_select_own',
      policy_record.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()))',
      'agenda_' || policy_record.table_name || '_insert_own',
      policy_record.table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid())) WITH CHECK (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()))',
      'agenda_' || policy_record.table_name || '_update_own',
      policy_record.table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()))',
      'agenda_' || policy_record.table_name || '_delete_own',
      policy_record.table_name
    );
  END LOOP;
END;
$policies$;

COMMIT;
