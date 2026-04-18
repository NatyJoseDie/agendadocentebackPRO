import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()

// GET /api/libro-temas?curso_id=xxx — listar temas de un curso
router.get('/', requireAuth, async (req, res) => {
  const { curso_id } = req.query
  if (!curso_id) return res.status(400).json({ error: 'Parámetro curso_id es requerido' })

  const db = supabaseForUser(req.token)
  const { data, error } = await db
    .from('libro_temas')
    .select('*')
    .eq('curso_id', curso_id)
    .eq('docente_id', req.user.id)
    .order('fecha', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/libro-temas — cargar/actualizar tema del día
router.post('/', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { curso_id, fecha, temas_dados, recursos_actividades, evaluacion_clase, observaciones } = req.body

  if (!curso_id || !temas_dados) {
    return res.status(400).json({ error: 'curso_id y temas_dados son obligatorios' })
  }

  const { data, error } = await db
    .from('libro_temas')
    .upsert({
      docente_id: req.user.id,
      curso_id,
      fecha: fecha || new Date().toISOString().split('T')[0],
      temas_dados,
      recursos_actividades,
      evaluacion_clase,
      observaciones
    }, { onConflict: 'curso_id,fecha' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// PUT /api/libro-temas/:id — editar un registro guardado
router.put('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { temas_dados, recursos_actividades, evaluacion_clase, observaciones } = req.body

  const { data, error } = await db
    .from('libro_temas')
    .update({ temas_dados, recursos_actividades, evaluacion_clase, observaciones })
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /api/libro-temas/:id — borrar un registro
router.delete('/:id', requireAuth, async (req, res) => {
  const db = supabaseForUser(req.token)
  const { error } = await db
    .from('libro_temas')
    .delete()
    .eq('id', req.params.id)
    .eq('docente_id', req.user.id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ message: 'Registro eliminado' })
})

export default router
