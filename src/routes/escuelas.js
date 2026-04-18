import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/escuelas — listar mis escuelas
router.get('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('escuelas')
    .select('*, cursos(count)')
    .eq('docente_id', req.user.id)
    .eq('activo', true)
    .order('nombre', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/escuelas — agregar una escuela
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, numero, direccion, cargo, cantidad_horas, situacion_revista, localidad, provincia, nivel, cue, telefono } = req.body

  if (!nombre) return res.status(400).json({ error: 'El nombre de la escuela es obligatorio' })

  const { data, error } = await db
    .from('escuelas')
    .insert({ docente_id: req.user.id, nombre, numero, direccion, cargo, cantidad_horas, situacion_revista, localidad, provincia, nivel, cue, telefono })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/escuelas/:id — editar escuela
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, numero, direccion, cargo, cantidad_horas, situacion_revista, localidad, provincia, nivel, cue, telefono } = req.body

  const { data, error } = await db
    .from('escuelas')
    .update({ nombre, numero, direccion, cargo, cantidad_horas, situacion_revista, localidad, provincia, nivel, cue, telefono })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/escuelas/:id — baja lógica
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('escuelas')
    .update({ activo: false })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Escuela eliminada' })
})

export default router
