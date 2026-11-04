import { supabaseAdmin } from '../config/supabase.js'
import { requireWritable } from './requireWritable.js'

/**
 * Middleware de autenticación:
 * Verifica el JWT de Supabase y adjunta el usuario a req.user
 */
export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado: falta token' })
  }

  const token = authHeader.slice('Bearer '.length).trim()
  if (!token) return res.status(401).json({ error: 'No autorizado: falta token' })

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' })
    }

    req.user = user
    req.token = token
    if (
      !req.skipSubscriptionWriteCheck &&
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    ) {
      return requireWritable(req, res, next)
    }

    return next()
  } catch (error) {
    console.error('Error al verificar el token de autenticación:', error.message)
    return res.status(503).json({ error: 'No se pudo verificar la autenticación.' })
  }
}
