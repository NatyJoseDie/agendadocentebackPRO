import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

const DIAS = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' }

// GET /api/horarios?curso_id=xxx — ver días de clase de un curso
router.get('/', requireAuth, async (req, res) => {
  const { curso_id } = req.query
  if (!curso_id) return res.status(400).json({ error: 'Parámetro curso_id es requerido' })

  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('horarios_curso')
    .select('*')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)
    .order('dia_semana', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  // Agregamos el nombre del día para mayor claridad
  const enriched = data.map(h => ({ ...h, dia_nombre: DIAS[h.dia_semana] }))
  res.json(enriched)
})

// POST /api/horarios — agregar un día de clase (o varios con array)
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const registros = Array.isArray(req.body) ? req.body : [req.body]

  const data_to_insert = registros.map(r => ({
    curso_id: r.curso_id,
    docente_id: req.user.id,
    dia_semana: r.dia_semana,
    hora_inicio: r.hora_inicio || null,
    hora_fin: r.hora_fin || null,
  }))

  const { data, error } = await db
    .from('horarios_curso')
    .upsert(data_to_insert, { onConflict: 'curso_id,dia_semana' })
    .select()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// DELETE /api/horarios/:id — quitar un día de clase
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('horarios_curso')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Día de clase eliminado' })
})

export default router
