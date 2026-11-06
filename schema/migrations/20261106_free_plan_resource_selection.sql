-- Keeps existing data but restricts over-limit free accounts to the school and
-- up to two courses they select after their read-only grace period.

BEGIN;

ALTER TABLE public.docentes
  ADD COLUMN IF NOT EXISTS free_plan_selection_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS free_plan_school_id UUID,
  ADD COLUMN IF NOT EXISTS free_plan_course_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS free_plan_selection_locked_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.docente_puede_escribir(p_docente_id UUID)
RETURNS BOOLEAN
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
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.preparar_limites_plan_gratuito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_escuelas BIGINT;
  v_cursos BIGINT;
BEGIN
  IF NEW.plan IN ('pro', 'premium')
    OR NEW.subscription_plan IN ('pro', 'premium')
  THEN
    NEW.free_plan_selection_required := FALSE;
    NEW.free_plan_school_id := NULL;
    NEW.free_plan_course_ids := '{}';
    NEW.free_plan_selection_locked_at := NULL;
  ELSIF (
    coalesce(OLD.plan, '') IN ('pro', 'premium')
    OR coalesce(OLD.subscription_plan, '') IN ('pro', 'premium')
  ) AND NEW.plan = 'gratuito'
    AND NEW.subscription_plan = 'free'
  THEN
    SELECT count(*) INTO v_escuelas
    FROM public.escuelas
    WHERE docente_id = NEW.id AND activo IS TRUE;

    SELECT count(*) INTO v_cursos
    FROM public.cursos
    WHERE docente_id = NEW.id AND activo IS TRUE;

    NEW.free_plan_selection_required := v_escuelas > 1 OR v_cursos > 2;
    NEW.free_plan_school_id := NULL;
    NEW.free_plan_course_ids := '{}';
    NEW.free_plan_selection_locked_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS docentes_preparar_limites_plan_gratuito ON public.docentes;
CREATE TRIGGER docentes_preparar_limites_plan_gratuito
  BEFORE UPDATE OF plan, subscription_plan ON public.docentes
  FOR EACH ROW
  EXECUTE FUNCTION public.preparar_limites_plan_gratuito();

CREATE OR REPLACE FUNCTION public.docente_puede_acceder_escuela(
  p_docente_id UUID,
  p_escuela_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requerida BOOLEAN;
  v_escuela_seleccionada UUID;
  v_seleccion_bloqueada TIMESTAMPTZ;
BEGIN
  IF p_docente_id IS DISTINCT FROM auth.uid()
    AND coalesce(auth.role(), '') <> 'service_role'
  THEN
    RETURN FALSE;
  END IF;

  SELECT free_plan_selection_required, free_plan_school_id, free_plan_selection_locked_at
    INTO v_requerida, v_escuela_seleccionada, v_seleccion_bloqueada
  FROM public.docentes
  WHERE id = p_docente_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT v_requerida THEN RETURN TRUE; END IF;
  IF v_seleccion_bloqueada IS NULL THEN RETURN FALSE; END IF;

  RETURN p_escuela_id = v_escuela_seleccionada
    AND EXISTS (
      SELECT 1 FROM public.escuelas
      WHERE id = p_escuela_id AND docente_id = p_docente_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.docente_puede_acceder_curso(
  p_docente_id UUID,
  p_curso_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requerida BOOLEAN;
  v_escuela_seleccionada UUID;
  v_cursos_seleccionados UUID[];
  v_seleccion_bloqueada TIMESTAMPTZ;
BEGIN
  IF p_docente_id IS DISTINCT FROM auth.uid()
    AND coalesce(auth.role(), '') <> 'service_role'
  THEN
    RETURN FALSE;
  END IF;

  SELECT free_plan_selection_required, free_plan_school_id,
         free_plan_course_ids, free_plan_selection_locked_at
    INTO v_requerida, v_escuela_seleccionada,
         v_cursos_seleccionados, v_seleccion_bloqueada
  FROM public.docentes
  WHERE id = p_docente_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF NOT v_requerida THEN RETURN TRUE; END IF;
  IF v_seleccion_bloqueada IS NULL THEN RETURN FALSE; END IF;

  RETURN p_curso_id = ANY(v_cursos_seleccionados)
    AND EXISTS (
      SELECT 1 FROM public.cursos
      WHERE id = p_curso_id
        AND docente_id = p_docente_id
        AND (escuela_id IS NULL OR escuela_id = v_escuela_seleccionada)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.docente_puede_acceder_alumno(
  p_docente_id UUID,
  p_alumno_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_curso_id UUID;
BEGIN
  IF p_alumno_id IS NULL THEN RETURN TRUE; END IF;

  SELECT curso_id INTO v_curso_id
  FROM public.alumnos
  WHERE id = p_alumno_id AND docente_id = p_docente_id;

  IF NOT FOUND THEN RETURN FALSE; END IF;
  RETURN public.docente_puede_acceder_curso(p_docente_id, v_curso_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.docente_puede_acceder_recursos(
  p_docente_id UUID,
  p_escuela_id UUID,
  p_curso_id UUID,
  p_alumno_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (p_escuela_id IS NULL OR public.docente_puede_acceder_escuela(p_docente_id, p_escuela_id))
    AND (p_curso_id IS NULL OR public.docente_puede_acceder_curso(p_docente_id, p_curso_id))
    AND (p_alumno_id IS NULL OR public.docente_puede_acceder_alumno(p_docente_id, p_alumno_id));
$$;

CREATE OR REPLACE FUNCTION public.obtener_opciones_plan_gratuito()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_docente_id UUID := auth.uid();
  v_requerida BOOLEAN;
  v_escuela_seleccionada UUID;
  v_seleccion_bloqueada TIMESTAMPTZ;
BEGIN
  IF v_docente_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere una sesión autenticada.';
  END IF;

  SELECT free_plan_selection_required, free_plan_school_id,
         free_plan_selection_locked_at
    INTO v_requerida, v_escuela_seleccionada, v_seleccion_bloqueada
  FROM public.docentes
  WHERE id = v_docente_id;

  IF NOT FOUND OR NOT v_requerida OR v_seleccion_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'No hay una selección gratuita pendiente.';
  END IF;

  RETURN jsonb_build_object(
    'escuelas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'nombre', e.nombre,
        'numero', e.numero,
        'nivel', e.nivel
      ) ORDER BY e.created_at, e.id)
      FROM public.escuelas AS e
      WHERE e.docente_id = v_docente_id AND e.activo IS TRUE
    ), '[]'::jsonb),
    'cursos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'nombre', c.nombre,
        'materia', c.materia,
        'anio_o_grado', c.anio_o_grado,
        'division', c.division,
        'escuela_id', c.escuela_id
      ) ORDER BY c.created_at, c.id)
      FROM public.cursos AS c
      WHERE c.docente_id = v_docente_id
        AND c.activo IS TRUE
        AND (v_escuela_seleccionada IS NULL OR c.escuela_id = v_escuela_seleccionada)
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seleccionar_recursos_plan_gratuito(
  p_escuela_id UUID,
  p_curso_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_docente_id UUID := auth.uid();
  v_requerida BOOLEAN;
  v_bloqueada TIMESTAMPTZ;
  v_escuelas_activas BIGINT;
  v_cursos_escuela BIGINT;
  v_cursos_distintos BIGINT;
BEGIN
  IF v_docente_id IS NULL THEN
    RAISE EXCEPTION 'Se requiere una sesión autenticada.';
  END IF;

  SELECT free_plan_selection_required, free_plan_selection_locked_at
    INTO v_requerida, v_bloqueada
  FROM public.docentes
  WHERE id = v_docente_id
  FOR UPDATE;

  IF NOT FOUND OR NOT v_requerida OR v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'La selección gratuita ya fue realizada o no corresponde.';
  END IF;

  IF p_curso_ids IS NULL OR cardinality(p_curso_ids) > 2
    OR cardinality(p_curso_ids) <> (
      SELECT count(DISTINCT selected_id)
      FROM unnest(p_curso_ids) AS selected_courses(selected_id)
    )
  THEN
    RAISE EXCEPTION 'Seleccioná como máximo dos cursos diferentes.';
  END IF;

  SELECT count(*) INTO v_escuelas_activas
  FROM public.escuelas
  WHERE docente_id = v_docente_id AND activo IS TRUE;

  IF v_escuelas_activas > 0 AND p_escuela_id IS NULL THEN
    RAISE EXCEPTION 'Seleccioná una escuela para el Plan Gratuito.';
  END IF;

  IF p_escuela_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.escuelas
    WHERE id = p_escuela_id
      AND docente_id = v_docente_id
      AND activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'La escuela seleccionada no pertenece a tu cuenta.';
  END IF;

  IF cardinality(p_curso_ids) > 0 THEN
    SELECT count(*), count(DISTINCT c.id)
      INTO v_cursos_escuela, v_cursos_distintos
    FROM public.cursos AS c
    WHERE c.id = ANY(p_curso_ids)
      AND c.docente_id = v_docente_id
      AND c.activo IS TRUE
      AND (c.escuela_id IS NULL OR c.escuela_id = p_escuela_id);

    IF v_cursos_escuela <> cardinality(p_curso_ids)
      OR v_cursos_distintos <> cardinality(p_curso_ids)
    THEN
      RAISE EXCEPTION 'Los cursos deben pertenecer a tu cuenta y a la escuela seleccionada.';
    END IF;
  END IF;

  UPDATE public.docentes
  SET free_plan_school_id = p_escuela_id,
      free_plan_course_ids = p_curso_ids,
      free_plan_selection_locked_at = statement_timestamp(),
      updated_at = statement_timestamp()
  WHERE id = v_docente_id;
END;
$$;

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
  v_limite INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.docente_id::TEXT || ':' || TG_TABLE_NAME, 0));

  SELECT plan, subscription_plan, trial_ends_at,
         free_plan_selection_required, email
    INTO v_plan, v_subscription_plan, v_trial_ends_at, v_requerida, v_email
  FROM public.docentes
  WHERE id = NEW.docente_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró el perfil docente.';
  END IF;

  IF lower(coalesce(v_email, '')) IN (
    'nbarzotti6@gmail.com',
    'natalia@agendadocente.com',
    'admin@agendadocente.com'
  ) OR (
    (v_plan IN ('pro', 'premium') OR v_subscription_plan IN ('pro', 'premium'))
    AND (v_trial_ends_at IS NULL OR v_trial_ends_at > statement_timestamp())
  ) THEN
    RETURN NEW;
  END IF;

  IF v_requerida THEN
    RAISE EXCEPTION 'Elegí los recursos del Plan Gratuito antes de crear nuevos.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'escuelas' THEN
    v_limite := 1;
    SELECT count(*) INTO v_total FROM public.escuelas
    WHERE docente_id = NEW.docente_id AND activo IS TRUE;
  ELSE
    v_limite := 2;
    SELECT count(*) INTO v_total FROM public.cursos
    WHERE docente_id = NEW.docente_id AND activo IS TRUE;
  END IF;

  IF v_total >= v_limite THEN
    RAISE EXCEPTION 'El Plan Gratuito permite hasta % %.', v_limite, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.proteger_seleccion_plan_gratuito()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seleccion_requerida BOOLEAN;
  v_seleccion_bloqueada TIMESTAMPTZ;
  v_seleccionada BOOLEAN;
BEGIN
  SELECT free_plan_selection_required, free_plan_selection_locked_at,
         CASE TG_TABLE_NAME
           WHEN 'escuelas' THEN free_plan_school_id = OLD.id
           ELSE OLD.id = ANY(free_plan_course_ids)
         END
    INTO v_seleccion_requerida, v_seleccion_bloqueada, v_seleccionada
  FROM public.docentes
  WHERE id = OLD.docente_id;

  IF TG_OP = 'DELETE' THEN
    IF v_seleccion_requerida AND v_seleccion_bloqueada IS NOT NULL
      AND v_seleccionada
    THEN
      RAISE EXCEPTION 'No podés eliminar el recurso elegido para tu Plan Gratuito.'
        USING ERRCODE = '42501';
    END IF;

    RETURN OLD;
  END IF;

  IF v_seleccion_requerida AND v_seleccion_bloqueada IS NOT NULL
    AND v_seleccionada
    AND OLD.activo IS TRUE
    AND NEW.activo IS FALSE
  THEN
    RAISE EXCEPTION 'No podés desactivar el recurso elegido para tu Plan Gratuito.'
      USING ERRCODE = '42501';
  END IF;

  IF TG_TABLE_NAME = 'cursos' THEN
    IF v_seleccion_requerida
      AND v_seleccion_bloqueada IS NOT NULL
      AND v_seleccionada
      AND NEW.escuela_id IS DISTINCT FROM OLD.escuela_id
    THEN
      RAISE EXCEPTION 'No podés mover el curso elegido a otra escuela en el Plan Gratuito.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limitar_altas_escuelas_plan_gratuito ON public.escuelas;
CREATE TRIGGER limitar_altas_escuelas_plan_gratuito
  BEFORE INSERT ON public.escuelas
  FOR EACH ROW EXECUTE FUNCTION public.limitar_altas_plan_gratuito();

DROP TRIGGER IF EXISTS limitar_altas_cursos_plan_gratuito ON public.cursos;
CREATE TRIGGER limitar_altas_cursos_plan_gratuito
  BEFORE INSERT ON public.cursos
  FOR EACH ROW EXECUTE FUNCTION public.limitar_altas_plan_gratuito();

DROP TRIGGER IF EXISTS proteger_seleccion_escuela_plan_gratuito ON public.escuelas;
CREATE TRIGGER proteger_seleccion_escuela_plan_gratuito
  BEFORE UPDATE OF activo ON public.escuelas
  FOR EACH ROW EXECUTE FUNCTION public.proteger_seleccion_plan_gratuito();

DROP TRIGGER IF EXISTS proteger_seleccion_curso_plan_gratuito ON public.cursos;
CREATE TRIGGER proteger_seleccion_curso_plan_gratuito
  BEFORE UPDATE OF activo, escuela_id ON public.cursos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_seleccion_plan_gratuito();

DROP TRIGGER IF EXISTS impedir_eliminar_seleccion_escuela_plan_gratuito ON public.escuelas;
CREATE TRIGGER impedir_eliminar_seleccion_escuela_plan_gratuito
  BEFORE DELETE ON public.escuelas
  FOR EACH ROW EXECUTE FUNCTION public.proteger_seleccion_plan_gratuito();

DROP TRIGGER IF EXISTS impedir_eliminar_seleccion_curso_plan_gratuito ON public.cursos;
CREATE TRIGGER impedir_eliminar_seleccion_curso_plan_gratuito
  BEFORE DELETE ON public.cursos
  FOR EACH ROW EXECUTE FUNCTION public.proteger_seleccion_plan_gratuito();

REVOKE ALL ON FUNCTION public.obtener_opciones_plan_gratuito() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.seleccionar_recursos_plan_gratuito(UUID, UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.docente_puede_acceder_escuela(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.docente_puede_acceder_curso(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.docente_puede_acceder_alumno(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.docente_puede_acceder_recursos(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.docente_puede_escribir(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.obtener_opciones_plan_gratuito() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.seleccionar_recursos_plan_gratuito(UUID, UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.docente_puede_acceder_escuela(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.docente_puede_acceder_curso(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.docente_puede_acceder_alumno(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.docente_puede_acceder_recursos(UUID, UUID, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.docente_puede_escribir(UUID) TO authenticated, service_role;

DO $policies$
DECLARE
  v_table TEXT;
  v_scope TEXT;
  v_has_school BOOLEAN;
  v_has_course BOOLEAN;
  v_has_student BOOLEAN;
  v_docente_column BOOLEAN;
  v_existing RECORD;
  v_tables TEXT[] := ARRAY[
    'escuelas', 'cursos', 'horarios_curso', 'alumnos', 'asistencias',
    'calificaciones', 'planificaciones', 'contactos', 'calendario',
    'eventos_academicos', 'proyectos', 'salidas', 'salidas_educativas',
    'condiciones_especiales', 'comunicaciones', 'intensificaciones',
    'libro_temas', 'licencias', 'planilla_oficial', 'seguimiento_diario',
    'copias_seguridad'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT
      bool_or(column_name = 'docente_id'),
      bool_or(column_name = 'escuela_id'),
      bool_or(column_name = 'curso_id'),
      bool_or(column_name = 'alumno_id')
    INTO v_docente_column, v_has_school, v_has_course, v_has_student
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = v_table;

    IF NOT coalesce(v_docente_column, FALSE) THEN
      CONTINUE;
    END IF;

    v_scope := format(
      'public.docente_puede_acceder_recursos(auth.uid(), %s, %s, %s)',
      CASE WHEN v_has_school THEN 'escuela_id' ELSE 'NULL::uuid' END,
      CASE WHEN v_has_course THEN 'curso_id' ELSE 'NULL::uuid' END,
      CASE WHEN v_has_student THEN 'alumno_id' ELSE 'NULL::uuid' END
    );

    IF v_table = 'escuelas' THEN
      v_scope := 'public.docente_puede_acceder_escuela(auth.uid(), id)';
    ELSIF v_table = 'cursos' THEN
      v_scope := 'public.docente_puede_acceder_curso(auth.uid(), id)';
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    FOR v_existing IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_existing.policyname, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.uid() = docente_id AND %s)',
      'agenda_' || v_table || '_select_own', v_table, v_scope
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()) AND %s)',
      'agenda_' || v_table || '_insert_own', v_table,
      CASE WHEN v_table IN ('escuelas', 'cursos') THEN 'TRUE' ELSE v_scope END
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()) AND %s) WITH CHECK (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()) AND %s)',
      'agenda_' || v_table || '_update_own', v_table, v_scope, v_scope
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (auth.uid() = docente_id AND public.docente_puede_escribir(auth.uid()) AND %s)',
      'agenda_' || v_table || '_delete_own', v_table, v_scope
    );
  END LOOP;
END;
$policies$;

DO $views$
DECLARE
  v_view TEXT;
  v_views TEXT[] := ARRAY[
    'v_cursos_con_escuela',
    'v_planilla_oficial',
    'v_calendario_maestro'
  ];
BEGIN
  FOREACH v_view IN ARRAY v_views LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_view
        AND c.relkind = 'v'
    ) THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v_view);
    END IF;
  END LOOP;
END;
$views$;

COMMIT;
