import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseForUser } from '../config/supabase.js'

const router = Router()
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

router.get('/', requireAuth, async (req, res) => {
  const limite = Number(req.query.limite ?? 20)
  if (!Number.isInteger(limite) || limite < 1 || limite > 50) {
    return res.status(400).json({ error: 'limite debe ser un entero entre 1 y 50.' })
  }

  try {
    const db = supabaseForUser(req.token)
    const [notificaciones, noLeidas] = await Promise.all([
      db
        .from('notificaciones_docente')
        .select('id, tipo, titulo, mensaje, programada_para, leida_at, created_at')
        .eq('docente_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(limite),
      db
        .from('notificaciones_docente')
        .select('id', { count: 'exact', head: true })
        .eq('docente_id', req.user.id)
        .is('leida_at', null),
    ])

    if (notificaciones.error) throw notificaciones.error
    if (noLeidas.error) throw noLeidas.error

    res.json({
      notificaciones: notificaciones.data || [],
      noLeidas: noLeidas.count || 0,
    })
  } catch (error) {
    console.error('❌ Error al obtener notificaciones:', error.message)
    res.status(500).json({ error: 'No se pudieron obtener las notificaciones.' })
  }
})

router.patch('/:id/leida', (req, _res, next) => {
  req.skipSubscriptionWriteCheck = true
  next()
}, requireAuth, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) {
    return res.status(400).json({ error: 'El ID de la notificación no es válido.' })
  }

  try {
    const db = supabaseForUser(req.token)
    const { data, error } = await db
      .from('notificaciones_docente')
      .update({ leida_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('docente_id', req.user.id)
      .select('id, leida_at')
      .maybeSingle()

    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Notificación no encontrada.' })

    res.json({ notificacion: data })
  } catch (error) {
    console.error('❌ Error al marcar notificación como leída:', error.message)
    res.status(500).json({ error: 'No se pudo actualizar la notificación.' })
  }
})

export default router
