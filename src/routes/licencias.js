import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/licencias — obtener mis licencias del año
router.get('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('licencias')
    .select('*')
    .eq('docente_id', req.user.id)
    .order('fecha_desde', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/licencias — registrar licencia
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { tipo_licencia, fecha_desde, fecha_hasta, articulo, observaciones } = req.body

  if (!tipo_licencia || !fecha_desde) {
    return res.status(400).json({ error: 'tipo_licencia y fecha_desde son requeridos' })
  }

  const { data, error } = await db
    .from('licencias')
    .insert({
      docente_id: req.user.id,
      tipo_licencia,
      fecha_desde,
      fecha_hasta,
      articulo,
      observaciones
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/licencias/:id — editar licencia
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { tipo_licencia, fecha_desde, fecha_hasta, articulo, observaciones } = req.body

  const { data, error } = await db
    .from('licencias')
    .update({ tipo_licencia, fecha_desde, fecha_hasta, articulo, observaciones })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/licencias/:id — eliminar registro
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('licencias')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Licencia eliminada' })
})

export default router
