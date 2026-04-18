import { supabaseAdmin } from '../config/supabase.js'

/**
 * Middleware de autenticación:
 * Verifica el JWT de Supabase y adjunta el usuario a req.user
 */
export const requireAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No autorizado: falta token' })
  }

  const token = authHeader.replace('Bearer ', '')

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)

  if (error || !user) {
    return res.status(401).json({ error: 'Token inválido o expirado' })
  }

  req.user = user
  req.token = token
  next()
}
