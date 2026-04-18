import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/necesidades/:alumno_id — ver condiciones de un alumno
router.get('/:alumno_id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('condiciones_especiales')
    .select('*')
    .eq('alumno_id', req.params.alumno_id)
    .eq('docente_id', req.user.id)
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/necesidades — registrar condición especial
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const {
    alumno_id, tipo_condicion, descripcion,
    adaptaciones_curriculares,
    necesita_acompañante,
    observaciones
  } = req.body

  if (!alumno_id || !tipo_condicion)
    return res.status(400).json({ error: 'alumno_id y tipo_condicion son obligatorios' })

  const { data, error } = await db
    .from('condiciones_especiales')
    .insert({
      docente_id: req.user.id,
      alumno_id,
      tipo_condicion,
      descripcion,
      adaptaciones_curriculares,
      necesita_acompañante: necesita_acompañante ?? false,
      observaciones
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/necesidades/:id (reemplazo completo)
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { tipo_condicion, descripcion, adaptaciones_curriculares, necesita_acompañante, observaciones } = req.body

  const { data, error } = await db
    .from('condiciones_especiales')
    .update({ tipo_condicion, descripcion, adaptaciones_curriculares, necesita_acompañante, observaciones })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PATCH /api/necesidades/:id (edición parcial)
router.patch('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const updates = req.body

  const { data, error } = await db
    .from('condiciones_especiales')
    .update(updates)
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/necesidades/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('condiciones_especiales')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Registro eliminado' })
})

export default router
