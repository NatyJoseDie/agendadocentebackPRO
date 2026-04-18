import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/salidas?curso_id=xxx
router.get('/', requireAuth, async (req, res) => {
  const { curso_id } = req.query
  const db = supabaseForUser(req.token)

  let query = db
    .from('salidas_educativas')
    .select('*, cursos(nombre)')
    .eq('docente_id', req.user.id)
    .order('fecha', { ascending: true })

  if (curso_id) query = query.eq('curso_id', curso_id)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// GET /api/salidas/:id
router.get('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('salidas_educativas')
    .select('*, cursos(nombre)')
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .single()

  if (error) return res.status(404).json({ error: 'Salida no encontrada' })
  res.json(data)
})

// POST /api/salidas
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const {
    curso_id, titulo, destino, descripcion, fecha,
    hora_salida, hora_regreso, costo, requiere_autorizacion,
    observaciones
  } = req.body

  if (!titulo || !destino || !fecha)
    return res.status(400).json({ error: 'titulo, destino y fecha son obligatorios' })

  const { data, error } = await db
    .from('salidas_educativas')
    .insert({
      docente_id: req.user.id, curso_id, titulo, destino, descripcion,
      fecha, hora_salida, hora_regreso, costo,
      requiere_autorizacion: requiere_autorizacion ?? true,
      observaciones, estado: 'planificada'
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/salidas/:id
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { titulo, destino, descripcion, fecha, hora_salida, hora_regreso, costo, estado, observaciones } = req.body

  const { data, error } = await db
    .from('salidas_educativas')
    .update({ titulo, destino, descripcion, fecha, hora_salida, hora_regreso, costo, estado, observaciones })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/salidas/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('salidas_educativas')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Salida eliminada' })
})

export default router
