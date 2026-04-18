import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/proyectos?curso_id=xxx
router.get('/', requireAuth, async (req, res) => {
  const { curso_id } = req.query
  const db = supabaseForUser(req.token)

  let query = db
    .from('proyectos')
    .select('*')
    .eq('docente_id', req.user.id)
    .order('fecha_inicio', { ascending: true })

  if (curso_id) query = query.eq('curso_id', curso_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/proyectos/:id
router.get('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('proyectos')
    .select('*')
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .single()

  if (error) return res.status(404).json({ error: 'Proyecto no encontrado' })
  res.json(data)
})

// POST /api/proyectos
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { curso_id, titulo, descripcion, area, objetivos, fecha_inicio, fecha_fin, estado } = req.body

  if (!titulo) return res.status(400).json({ error: 'El título es obligatorio' })

  const { data, error } = await db
    .from('proyectos')
    .insert({ docente_id: req.user.id, curso_id, titulo, descripcion, area, objetivos, fecha_inicio, fecha_fin, estado: estado || 'en_curso' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/proyectos/:id
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { titulo, descripcion, area, objetivos, fecha_inicio, fecha_fin, estado } = req.body

  const { data, error } = await db
    .from('proyectos')
    .update({ titulo, descripcion, area, objetivos, fecha_inicio, fecha_fin, estado, updated_at: new Date() })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/proyectos/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('proyectos')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Proyecto eliminado' })
})

export default router
