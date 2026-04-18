import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/calendario?mes=3&anio=2025
router.get('/', requireAuth, async (req, res) => {
  const { mes, anio, tipo } = req.query
  const db = supabaseForUser(req.token)

  let query = db
    .from('calendario')
    .select('*')
    .eq('docente_id', req.user.id)
    .order('fecha_inicio', { ascending: true })

  if (anio) {
    const desde = `${anio}-01-01`
    const hasta = `${anio}-12-31`
    query = query.gte('fecha_inicio', desde).lte('fecha_inicio', hasta)
  }
  if (mes && anio) {
    const mm = String(mes).padStart(2, '0')
    query = query
      .gte('fecha_inicio', `${anio}-${mm}-01`)
      .lte('fecha_inicio', `${anio}-${mm}-31`)
  }
  if (tipo) query = query.eq('tipo', tipo)

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/calendario — crear evento
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { titulo, descripcion, fecha_inicio, fecha_fin, tipo, color, todo_dia } = req.body

  if (!titulo || !fecha_inicio)
    return res.status(400).json({ error: 'titulo y fecha_inicio son obligatorios' })

  const { data, error } = await db
    .from('calendario')
    .insert({ docente_id: req.user.id, titulo, descripcion, fecha_inicio, fecha_fin, tipo, color, todo_dia })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/calendario/:id
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { titulo, descripcion, fecha_inicio, fecha_fin, tipo, color, todo_dia } = req.body

  const { data, error } = await db
    .from('calendario')
    .update({ titulo, descripcion, fecha_inicio, fecha_fin, tipo, color, todo_dia })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/calendario/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('calendario')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Evento eliminado' })
})

export default router
