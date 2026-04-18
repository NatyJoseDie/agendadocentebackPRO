import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/contactos — listar todos los contactos/mensajes
router.get('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  
  // Opcional: filtrar por alumno si envían ?alumno_id=
  let query = db
    .from('contactos')
    .select('*, alumnos(nombre, apellido)')
    .eq('docente_id', req.user.id)
    .order('fecha', { ascending: false })

  if (req.query.alumno_id) {
    query = query.eq('alumno_id', req.query.alumno_id)
  }

  const { data, error } = await query

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/contactos — registrar una nueva comunicación o contacto
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { alumno_id, tipo, asunto, descripcion, fecha } = req.body

  if (!asunto) return res.status(400).json({ error: 'El asunto es obligatorio' })

  const payload = {
    docente_id: req.user.id,
    alumno_id: alumno_id || null, // Puede ser null si es contacto con dirección/colega
    tipo,
    asunto,
    descripcion,
    fecha: fecha || new Date().toISOString().split('T')[0]
  }

  const { data, error } = await db
    .from('contactos')
    .insert(payload)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/contactos/:id — editar
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { alumno_id, tipo, asunto, descripcion, fecha } = req.body

  const { data, error } = await db
    .from('contactos')
    .update({ alumno_id, tipo, asunto, descripcion, fecha })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/contactos/:id — eliminar
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('contactos')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Contacto eliminado' })
})

export default router
