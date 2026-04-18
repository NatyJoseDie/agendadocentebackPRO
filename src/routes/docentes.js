import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/docentes/me — obtener mi perfil
router.get('/me', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('docentes')
    .select('*')
    .eq('id', req.user.id)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Perfil no encontrado' })
  res.json(data)
})

// POST /api/docentes/me — crear perfil (onboarding)
router.post('/me', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, apellido, rol, escuela, provincia, turno } = req.body

  if (!rol) return res.status(400).json({ error: 'El rol es obligatorio' })

  const { data, error } = await db
    .from('docentes')
    .insert({
      id: req.user.id,
      email: req.user.email,
      nombre,
      apellido,
      rol,
      escuela,
      provincia: provincia || 'Buenos Aires',
      turno,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/docentes/me — actualizar perfil
router.put('/me', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { nombre, apellido, escuela, provincia, turno } = req.body

  const { data, error } = await db
    .from('docentes')
    .update({ nombre, apellido, escuela, provincia, turno, updated_at: new Date() })
    .eq('id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
