import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/alumnos?curso_id=xxx — listar alumnos de un curso
router.get('/', requireAuth, async (req, res) => {
  const { curso_id } = req.query
  if (!curso_id) return res.status(400).json({ error: 'Parámetro curso_id es requerido' })

  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('alumnos')
    .select('*')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)
    .eq('activo', true)
    .order('apellido', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/alumnos — agregar alumno
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { curso_id, nombre, apellido, dni, legajo, fecha_nacimiento, email_contacto, telefono_contacto, observaciones } = req.body

  if (!curso_id || !nombre || !apellido)
    return res.status(400).json({ error: 'curso_id, nombre y apellido son obligatorios' })

  const { data, error } = await db
    .from('alumnos')
    .insert({ docente_id: req.user.id, curso_id, nombre, apellido, dni, legajo, fecha_nacimiento, email_contacto, telefono_contacto, observaciones })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// GET /api/alumnos/:id — detalle de un alumno
router.get('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('alumnos')
    .select('*')
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .single()

  if (error) return res.status(404).json({ error: 'Alumno no encontrado' })
  res.json(data)
})

// PUT /api/alumnos/:id — editar alumno (reemplazo completo)
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, apellido, dni, legajo, fecha_nacimiento, email_contacto, telefono_contacto, observaciones } = req.body

  const { data, error } = await db
    .from('alumnos')
    .update({ nombre, apellido, dni, legajo, fecha_nacimiento, email_contacto, telefono_contacto, observaciones })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// PATCH /api/alumnos/:id — edición parcial del alumno
router.patch('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const updates = req.body

  const { data, error } = await db
    .from('alumnos')
    .update(updates)
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/alumnos/:id — baja lógica
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('alumnos')
    .update({ activo: false })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Alumno dado de baja correctamente' })
})

export default router
