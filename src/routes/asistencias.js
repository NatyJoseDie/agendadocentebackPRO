import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/asistencias?curso_id=xxx&fecha=yyyy-mm-dd
router.get('/', requireAuth, async (req, res) => {
  const { curso_id, fecha } = req.query
  if (!curso_id) return res.status(400).json({ error: 'Parámetro curso_id es requerido' })

  const db = supabaseForUser(req.token)
  let query = db
    .from('asistencias')
    .select('*, alumnos(nombre, apellido)')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)

  if (fecha) query = query.eq('fecha', fecha)

  const { data, error } = await query.order('fecha', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/asistencias — registrar asistencia (puede ser un array de registros)
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const registros = Array.isArray(req.body) ? req.body : [req.body]

  const data_to_insert = registros.map(r => ({
    alumno_id: r.alumno_id,
    curso_id: r.curso_id,
    docente_id: req.user.id,
    fecha: r.fecha,
    estado: r.estado,
    observacion: r.observacion || null,
  }))

  const { data, error } = await db
    .from('asistencias')
    .upsert(data_to_insert, { onConflict: 'alumno_id,fecha,curso_id' })
    .select()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/asistencias/:id — modificar un registro
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { estado, observacion } = req.body

  const { data, error } = await db
    .from('asistencias')
    .update({ estado, observacion })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/asistencias/estadisticas?curso_id=xxx&desde=yyyy-mm-dd&hasta=yyyy-mm-dd
// Devuelve porcentaje de asistencia por alumno en el período dado
router.get('/estadisticas', requireAuth, async (req, res) => {
  const { curso_id, desde, hasta } = req.query
  if (!curso_id) return res.status(400).json({ error: 'Parámetro curso_id es requerido' })

  const db = supabaseForUser(req.token)

  // Fecha por defecto: semana actual
  const hoy = new Date()
  const lunes = new Date(hoy)
  lunes.setDate(hoy.getDate() - hoy.getDay() + 1)
  const viernes = new Date(lunes)
  viernes.setDate(lunes.getDate() + 4)

  const fechaDesde = desde || lunes.toISOString().split('T')[0]
  const fechaHasta = hasta || viernes.toISOString().split('T')[0]

  // Traer todos los alumnos del curso
  const { data: alumnos, error: errAlumnos } = await db
    .from('alumnos')
    .select('id, nombre, apellido')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)
    .eq('activo', true)
    .order('apellido')

  if (errAlumnos) return res.status(500).json({ error: errAlumnos.message })

  // Traer todas las asistencias del período
  const { data: asistencias, error: errAsist } = await db
    .from('asistencias')
    .select('alumno_id, estado, fecha')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)
    .gte('fecha', fechaDesde)
    .lte('fecha', fechaHasta)

  if (errAsist) return res.status(500).json({ error: errAsist.message })

  // Calcular total de días de clase en el período (fechas únicas con asistencias)
  const diasConClase = [...new Set(asistencias.map(a => a.fecha))]
  const totalClases = diasConClase.length

  // Calcular estadísticas por alumno
  const estadisticas = alumnos.map(alumno => {
    const registros = asistencias.filter(a => a.alumno_id === alumno.id)
    const presentes      = registros.filter(r => r.estado === 'P').length
    const ausentes       = registros.filter(r => r.estado === 'A').length
    const tardanzas      = registros.filter(r => r.estado === 'T').length
    const justificados   = registros.filter(r => r.estado === 'AJ').length
    
    const total_ausentes = ausentes + tardanzas // Las tardanzas suelen contar como media falta en algunos sistemas
    const porcentaje     = totalClases > 0 ? Math.round((presentes / totalClases) * 100) : null
    
    // Alertas proactivas
    const en_riesgo           = porcentaje !== null && porcentaje < 75 
    const exceso_inasistencias = ausentes > 3 // Alerta específica solicitada por el usuario

    return {
      alumno_id: alumno.id,
      nombre: alumno.nombre,
      apellido: alumno.apellido,
      presentes,
      ausentes,
      tardanzas,
      justificados,
      sin_registrar: totalClases - registros.length,
      total_clases: totalClases,
      porcentaje_asistencia: porcentaje,
      en_riesgo_regularidad: en_riesgo, // ⚠️ menos del 75%
    }
  })

  res.json({
    periodo: { desde: fechaDesde, hasta: fechaHasta },
    total_clases: totalClases,
    dias_con_clase: diasConClase,
    alumnos: estadisticas,
  })
})

export default router
