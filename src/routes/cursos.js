import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/cursos — listar mis cursos
router.get('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('cursos')
    .select('*')
    .eq('docente_id', req.user.id)
    .eq('activo', true)
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/cursos — crear un curso
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, anio_o_grado, division, materia, turno, ciclo_lectivo, color } = req.body

  if (!nombre) return res.status(400).json({ error: 'El nombre del curso es obligatorio' })

  const { data, error } = await db
    .from('cursos')
    .insert({ docente_id: req.user.id, nombre, anio_o_grado, division, materia, turno, ciclo_lectivo, color })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// GET /api/cursos/:id — detalle de un curso
router.get('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('cursos')
    .select('*, alumnos(count)')
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .single()

  if (error) return res.status(404).json({ error: 'Curso no encontrado' })
  res.json(data)
})

// PUT /api/cursos/:id — editar curso
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, anio_o_grado, division, materia, turno, color } = req.body

  const { data, error } = await db
    .from('cursos')
    .update({ nombre, anio_o_grado, division, materia, turno, color })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/cursos/:id — eliminar (soft delete)
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('cursos')
    .update({ activo: false })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Curso eliminado correctamente' })
})

export default router
