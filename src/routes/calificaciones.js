import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/calificaciones?curso_id=xxx&periodo=xxx
router.get('/', requireAuth, async (req, res) => {
  const { curso_id, periodo, alumno_id } = req.query
  if (!curso_id) return res.status(400).json({ error: 'Parámetro curso_id es requerido' })

  const db = supabaseForUser(req.token)
  let query = db
    .from('calificaciones')
    .select('*, alumnos(nombre, apellido)')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)

  if (periodo) query = query.eq('periodo', periodo)
  if (alumno_id) query = query.eq('alumno_id', alumno_id)

  const { data, error } = await query.order('fecha', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/calificaciones — agregar nota
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { alumno_id, curso_id, tipo, descripcion, nota, periodo, fecha } = req.body

  if (!alumno_id || !curso_id || !tipo || nota === undefined)
    return res.status(400).json({ error: 'alumno_id, curso_id, tipo y nota son obligatorios' })

  if (nota < 1 || nota > 10)
    return res.status(400).json({ error: 'La nota debe estar entre 1 y 10' })

  const { data, error } = await db
    .from('calificaciones')
    .insert({ docente_id: req.user.id, alumno_id, curso_id, tipo, descripcion, nota, periodo, fecha })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/calificaciones/:id — editar nota
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { tipo, descripcion, nota, periodo, fecha } = req.body

  const { data, error } = await db
    .from('calificaciones')
    .update({ tipo, descripcion, nota, periodo, fecha })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/calificaciones/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('calificaciones')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Calificación eliminada' })
})

export default router
