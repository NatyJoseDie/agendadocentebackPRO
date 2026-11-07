import { Router } from 'express'
import { supabaseAdmin } from '../config/supabase.js'
import { requireAuth } from '../middleware/auth.js'
import { obtenerClavePublicaVapid } from '../services/notificacionesPush.js'
import { validarEndpointPush, validarPushSubscription } from '../utils/webPush.js'

const router = Router()

router.get('/vapid-public-key', (_req, res) => {
  const publicKey = obtenerClavePublicaVapid()
  if (!publicKey) {
    return res.status(503).json({
      error: 'Las notificaciones push todavía no están configuradas.',
      code: 'PUSH_NOT_CONFIGURED',
    })
  }

  return res.json({ publicKey })
})

router.post(
  '/suscripciones',
  (req, _res, next) => {
    req.skipSubscriptionWriteCheck = true
    next()
  },
  requireAuth,
  async (req, res) => {
    const errorValidacion = validarPushSubscription(req.body)
    if (errorValidacion) return res.status(400).json({ error: errorValidacion })
    if (!obtenerClavePublicaVapid()) {
      return res.status(503).json({
        error: 'Las notificaciones push todavía no están configuradas.',
        code: 'PUSH_NOT_CONFIGURED',
      })
    }

    try {
      const { expirationTime, keys } = req.body
      const endpoint = new URL(req.body.endpoint).toString()
      const { data: existente, error: consultaError } = await supabaseAdmin
        .from('push_suscripciones')
        .select('id, docente_id')
        .eq('endpoint', endpoint)
        .maybeSingle()

      if (consultaError) throw consultaError

      if (existente && existente.docente_id !== req.user.id) {
        return res.status(409).json({
          error: 'Este dispositivo está asociado a otra cuenta. Cerrá esa sesión antes de activarlo.',
          code: 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT',
        })
      }

      const valores = {
        docente_id: req.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        expiration_time: expirationTime ? new Date(expirationTime).toISOString() : null,
        updated_at: new Date().toISOString(),
      }

      const consulta = existente
        ? supabaseAdmin
          .from('push_suscripciones')
          .update(valores)
          .eq('id', existente.id)
        : supabaseAdmin
          .from('push_suscripciones')
          .insert(valores)

      const { error } = await consulta
      if (error) {
        if (error.code === '23505') {
          const { data: ocupante, error: ocupanteError } = await supabaseAdmin
            .from('push_suscripciones')
            .select('id, docente_id')
            .eq('endpoint', endpoint)
            .maybeSingle()

          if (ocupanteError) throw ocupanteError
          if (ocupante?.docente_id === req.user.id) {
            const { error: actualizarError } = await supabaseAdmin
              .from('push_suscripciones')
              .update(valores)
              .eq('id', ocupante.id)

            if (actualizarError) throw actualizarError
            return res.status(200).json({ registered: true })
          }

          return res.status(409).json({
            error: 'Este dispositivo está asociado a otra cuenta. Cerrá esa sesión antes de activarlo.',
            code: 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_ACCOUNT',
          })
        }
        throw error
      }

      return res.status(existente ? 200 : 201).json({ registered: true })
    } catch (error) {
      console.error('❌ Error al registrar una suscripción push:', error.message)
      return res.status(500).json({ error: 'No se pudo registrar la suscripción push.' })
    }
  },
)

router.delete(
  '/suscripciones',
  (req, _res, next) => {
    req.skipSubscriptionWriteCheck = true
    next()
  },
  requireAuth,
  async (req, res) => {
    const errorEndpoint = validarEndpointPush(req.body?.endpoint)
    if (errorEndpoint) {
      return res.status(400).json({ error: errorEndpoint })
    }

    try {
      const endpoint = new URL(req.body.endpoint).toString()
      const { data: existente, error: consultaError } = await supabaseAdmin
        .from('push_suscripciones')
        .select('id')
        .eq('endpoint', endpoint)
        .eq('docente_id', req.user.id)
        .maybeSingle()

      if (consultaError) throw consultaError

      if (!existente) return res.json({ deleted: false })

      const { error: entregasError } = await supabaseAdmin
        .from('notificaciones_push_envios')
        .delete()
        .eq('suscripcion_id', existente.id)
      if (entregasError) throw entregasError

      const { error } = await supabaseAdmin
        .from('push_suscripciones')
        .delete()
        .eq('id', existente.id)
        .eq('docente_id', req.user.id)

      if (error) throw error

      return res.json({ deleted: true })
    } catch (error) {
      console.error('❌ Error al eliminar una suscripción push:', error.message)
      return res.status(500).json({ error: 'No se pudo eliminar la suscripción push.' })
    }
  },
)

export default router
