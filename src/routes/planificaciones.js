import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/planificaciones?curso_id=xxx&tipo=anual
router.get('/', requireAuth, async (req, res) => {
  const { curso_id, tipo } = req.query
  const db = supabaseForUser(req.token)

  let query = db
    .from('planificaciones')
    .select('*, cursos(nombre, anio_o_grado)')
    .eq('docente_id', req.user.id)
    .order('created_at', { ascending: false })

  if (curso_id) query = query.eq('curso_id', curso_id)
  if (tipo) query = query.eq('tipo', tipo)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/planificaciones/:id
router.get('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('planificaciones')
    .select('*, cursos(nombre, anio_o_grado)')
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .single()

  if (error) return res.status(404).json({ error: 'Planificación no encontrada' })
  res.json(data)
})

// POST /api/planificaciones
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { curso_id, titulo, tipo, contenido, objetivos, recursos, periodo, fecha_clase } = req.body

  if (!curso_id || !titulo || !tipo)
    return res.status(400).json({ error: 'curso_id, titulo y tipo son obligatorios' })

  const { data, error } = await db
    .from('planificaciones')
    .insert({ docente_id: req.user.id, curso_id, titulo, tipo, contenido, objetivos, recursos, periodo, fecha_clase })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/planificaciones/:id
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { titulo, contenido, objetivos, recursos, periodo, fecha_clase } = req.body

  const { data, error } = await db
    .from('planificaciones')
    .update({ titulo, contenido, objetivos, recursos, periodo, fecha_clase, updated_at: new Date() })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/planificaciones/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('planificaciones')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Planificación eliminada' })
})

export default router
