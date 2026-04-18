-- ============================================================
--  AGENDA DOCENTE — Esquema de Base de Datos
--  Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- ─────────────────────────────────────────
-- 1. TABLA: docentes (perfiles de usuarios)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS docentes (
  id           UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email        TEXT NOT NULL,
  nombre       TEXT,
  apellido     TEXT,
  avatar_url   TEXT,
  rol          TEXT NOT NULL CHECK (rol IN ('maestro', 'profesor')),
  escuela      TEXT,
  provincia    TEXT DEFAULT 'Buenos Aires',
  turno        TEXT CHECK (turno IN ('mañana', 'tarde', 'noche', 'completo')),
  plan         TEXT DEFAULT 'gratuito' CHECK (plan IN ('gratuito', 'premium')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE docentes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "docentes_select_own" ON docentes FOR SELECT USING (auth.uid() = id);
CREATE POLICY "docentes_insert_own" ON docentes FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "docentes_update_own" ON docentes FOR UPDATE USING (auth.uid() = id);

-- ─────────────────────────────────────────
-- 2. TABLA: escuelas (cada docente puede tener hasta 25)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS escuelas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id        UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  nombre            TEXT NOT NULL,
  numero            TEXT,
  direccion         TEXT,
  cargo             TEXT,
  cantidad_horas    INTEGER,
  situacion_revista TEXT,
  localidad         TEXT,
  provincia         TEXT DEFAULT 'Buenos Aires',
  nivel             TEXT CHECK (nivel IN ('inicial', 'primaria', 'secundaria', 'terciario', 'especial')),
  cue               TEXT, -- Código Único de Establecimiento (número oficial del Ministerio)
  telefono          TEXT,
  activo            BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE escuelas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "escuelas_all_own" ON escuelas FOR ALL USING (auth.uid() = docente_id);


-- ─────────────────────────────────────────
-- 3. TABLA: cursos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cursos (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id     UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  escuela_id     UUID REFERENCES escuelas(id) ON DELETE SET NULL,
  nombre         TEXT NOT NULL,
  anio_o_grado   TEXT,
  division       TEXT,
  materia        TEXT,
  turno          TEXT CHECK (turno IN ('mañana', 'tarde', 'noche')),
  ciclo_lectivo  INTEGER DEFAULT 2026,
  color          TEXT DEFAULT '#3b82f6',
  activo         BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE cursos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cursos_all_own" ON cursos FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 4. TABLA: horarios_curso (qué días hay clase)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS horarios_curso (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  curso_id    UUID REFERENCES cursos(id) ON DELETE CASCADE NOT NULL,
  docente_id  UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  dia_semana  INTEGER NOT NULL CHECK (dia_semana BETWEEN 1 AND 5),
  -- 1=Lunes 2=Martes 3=Miércoles 4=Jueves 5=Viernes
  hora_inicio TIME,
  hora_fin    TIME,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(curso_id, dia_semana)
);

ALTER TABLE horarios_curso ENABLE ROW LEVEL SECURITY;
CREATE POLICY "horarios_all_own" ON horarios_curso FOR ALL USING (auth.uid() = docente_id);


-- ─────────────────────────────────────────
-- 3. TABLA: alumnos  ⚠️ Datos sensibles de menores
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alumnos (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  curso_id            UUID REFERENCES cursos(id) ON DELETE CASCADE NOT NULL,
  docente_id          UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  nombre              TEXT NOT NULL,
  apellido            TEXT NOT NULL,
  dni                 TEXT,
  legajo              TEXT,
  fecha_nacimiento    DATE,
  email_contacto      TEXT,
  telefono_contacto   TEXT,
  observaciones       TEXT,
  activo              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE alumnos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alumnos_all_own" ON alumnos FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 4. TABLA: asistencias
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asistencias (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alumno_id   UUID REFERENCES alumnos(id) ON DELETE CASCADE NOT NULL,
  curso_id    UUID REFERENCES cursos(id) ON DELETE CASCADE NOT NULL,
  docente_id  UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  fecha       DATE NOT NULL,
  estado      TEXT NOT NULL CHECK (estado IN ('presente', 'ausente', 'tardanza', 'justificado')),
  observacion TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alumno_id, fecha)
);

ALTER TABLE asistencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "asistencias_all_own" ON asistencias FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 5. TABLA: calificaciones
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calificaciones (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  alumno_id    UUID REFERENCES alumnos(id) ON DELETE CASCADE NOT NULL,
  curso_id     UUID REFERENCES cursos(id) ON DELETE CASCADE NOT NULL,
  docente_id   UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('tp', 'examen', 'oral', 'exposicion', 'otro')),
  descripcion  TEXT,
  nota         NUMERIC(4,2) CHECK (nota >= 1 AND nota <= 10),
  periodo      TEXT CHECK (periodo IN ('1er_trimestre', '2do_trimestre', '3er_trimestre', '1er_bimestre', '2do_bimestre', '3er_bimestre', '4to_bimestre')),
  fecha        DATE DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE calificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "calificaciones_all_own" ON calificaciones FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 6. TABLA: planificaciones
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planificaciones (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  curso_id      UUID REFERENCES cursos(id) ON DELETE CASCADE NOT NULL,
  docente_id    UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  titulo        TEXT NOT NULL,
  tipo          TEXT CHECK (tipo IN ('anual', 'clase', 'secuencia', 'proyecto')),
  contenido     TEXT,
  objetivos     TEXT,
  recursos      TEXT,
  periodo       TEXT,
  fecha_clase   DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE planificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "planificaciones_all_own" ON planificaciones FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 7. TABLA: contactos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contactos (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id  UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  alumno_id   UUID REFERENCES alumnos(id) ON DELETE SET NULL,
  tipo        TEXT CHECK (tipo IN ('familia', 'direccion', 'colega', 'otro')),
  asunto      TEXT NOT NULL,
  descripcion TEXT,
  fecha       DATE DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE contactos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contactos_all_own" ON contactos FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 8. TABLA: eventos_calendario
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eventos_calendario (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id  UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  titulo      TEXT NOT NULL,
  descripcion TEXT,
  fecha_inicio DATE NOT NULL,
  fecha_fin    DATE,
  tipo        TEXT CHECK (tipo IN ('efemeride', 'acto', 'evaluacion', 'reunion', 'personal', 'feriado')),
  color       TEXT DEFAULT '#3b82f6',
  todo_dia    BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE eventos_calendario ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eventos_all_own" ON eventos_calendario FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 9. TABLA: proyectos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proyectos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id    UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  curso_id      UUID REFERENCES cursos(id) ON DELETE SET NULL,
  titulo        TEXT NOT NULL,
  descripcion   TEXT,
  area          TEXT,
  objetivos     TEXT,
  fecha_inicio  DATE,
  fecha_fin     DATE,
  estado        TEXT DEFAULT 'en_curso' CHECK (estado IN ('planificado', 'en_curso', 'finalizado', 'pausado')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE proyectos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proyectos_all_own" ON proyectos FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 10. TABLA: salidas_educativas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salidas_educativas (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id            UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  curso_id              UUID REFERENCES cursos(id) ON DELETE SET NULL,
  titulo                TEXT NOT NULL,
  destino               TEXT NOT NULL,
  descripcion           TEXT,
  fecha                 DATE NOT NULL,
  hora_salida           TIME,
  hora_regreso          TIME,
  costo                 NUMERIC(10,2),
  requiere_autorizacion BOOLEAN DEFAULT TRUE,
  observaciones         TEXT,
  estado                TEXT DEFAULT 'planificada' CHECK (estado IN ('planificada', 'confirmada', 'realizada', 'cancelada')),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE salidas_educativas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "salidas_all_own" ON salidas_educativas FOR ALL USING (auth.uid() = docente_id);

-- ─────────────────────────────────────────
-- 11. TABLA: condiciones_especiales  ⚠️ Datos sensibles de menores
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS condiciones_especiales (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  docente_id                UUID REFERENCES docentes(id) ON DELETE CASCADE NOT NULL,
  alumno_id                 UUID REFERENCES alumnos(id) ON DELETE CASCADE NOT NULL,
  tipo_condicion            TEXT NOT NULL,
  -- Ejemplos de tipo_condicion: 'discapacidad', 'dificultad_aprendizaje', 'talento_alto', 'problema_salud', 'otro'
  descripcion               TEXT,
  adaptaciones_curriculares TEXT,
  necesita_acompañante      BOOLEAN DEFAULT FALSE,
  observaciones             TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE condiciones_especiales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "necesidades_all_own" ON condiciones_especiales FOR ALL USING (auth.uid() = docente_id);
