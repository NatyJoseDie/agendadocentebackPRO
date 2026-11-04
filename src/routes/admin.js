import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../config/supabase.js'

const router = Router()

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || [
  'nbarzotti6@gmail.com',
  'natalia@agendadocente.com',
  'admin@agendadocente.com',
].join(','))
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

const PLANES_VALIDOS = new Map([
  ['gratuito', 'gratuito'],
  ['free', 'gratuito'],
  ['pro', 'pro'],
  ['premium', 'premium'],
])

// Middleware de seguridad estricto para dueña / admin
const requireAdmin = (req, res, next) => {
  const email = req.user?.email?.toLowerCase()
  if (!email || !ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Acceso denegado: solo disponible para la administradora.' })
  }
  next()
}

/**
 * GET /api/admin/metricas
 * Retorna todas las estadísticas del negocio, usuarios y cobros de Mercado Pago
 */
router.get('/metricas', requireAuth, requireAdmin, async (req, res) => {
  try {
    // 1. Obtener todos los docentes
    const { data: docentes, error: errDocentes } = await supabaseAdmin
      .from('docentes')
      .select('id, email, nombre, apellido, avatar_url, plan, subscription_plan, is_premium, trial_ends_at, created_at')
      .order('created_at', { ascending: false })

    if (errDocentes) throw errDocentes

    // 2. Obtener todos los pagos
    const { data: pagos, error: errPagos } = await supabaseAdmin
      .from('pagos')
      .select('id, docente_id, mp_payment_id, monto, moneda, estado, metodo_pago, plan, fecha_pago, expira_at')
      .order('fecha_pago', { ascending: false })

    if (errPagos) throw errPagos

    // 3. Calcular ingresos totales aprobados
    const pagosAprobados = (pagos || []).filter(p => p.estado === 'approved')
    const totalRecaudado = pagosAprobados.reduce((acc, p) => acc + Number(p.monto || 0), 0)

    // 4. Calcular desglose de docentes
    const now = new Date()
    let countVip = 0
    let countPro = 0
    let countPremium = 0
    let countFree = 0
    let countVencidos = 0

    const listaDocentes = (docentes || []).map(d => {
      const isOwner = ADMIN_EMAILS.includes(d.email?.toLowerCase())
      let diasRestantes = null
      let estado = 'free'

      if (d.trial_ends_at) {
        const diff = new Date(d.trial_ends_at) - now
        diasRestantes = Math.ceil(diff / (1000 * 60 * 60 * 24))
      }

      if (isOwner) {
        estado = 'admin'
      } else if (diasRestantes !== null && diasRestantes <= 0) {
        estado = 'vencido'
        countVencidos++
      } else if (diasRestantes !== null && diasRestantes > 30) {
        estado = 'vip_beta'
        countVip++
      } else if (d.plan === 'premium' || d.subscription_plan === 'premium') {
        estado = 'premium'
        countPremium++
      } else if (d.plan === 'pro' || d.subscription_plan === 'pro') {
        estado = 'pro'
        countPro++
      } else {
        estado = 'free'
        countFree++
      }

      return {
        id: d.id,
        email: d.email,
        nombre: d.nombre || 'Docente',
        apellido: d.apellido || '',
        avatar_url: d.avatar_url,
        plan: d.plan,
        subscription_plan: d.subscription_plan,
        is_premium: d.is_premium,
        trial_ends_at: d.trial_ends_at,
        created_at: d.created_at,
        diasRestantes,
        estado,
      }
    })

    res.json({
      resumen: {
        totalRecaudado,
        totalDocentes: listaDocentes.length,
        countVip,
        countPro,
        countPremium,
        countFree,
        countVencidos,
        totalPagos: pagosAprobados.length,
      },
      docentes: listaDocentes,
      pagos: pagosAprobados,
    })
  } catch (err) {
    console.error('❌ Error al obtener métricas de admin:', err)
    res.status(500).json({ error: 'No se pudieron obtener las métricas.' })
  }
})

/**
 * POST /api/admin/modificar-docente
 * Permite a Natalia cambiar el plan o agregar días a cualquier usuario manualmente
 */
router.post('/modificar-docente', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { docente_id, nuevo_plan, dias_extra } = req.body || {}

    if (!docente_id) {
      return res.status(400).json({ error: 'Falta docente_id' })
    }

    const updateFields = { updated_at: new Date().toISOString() }

    if (nuevo_plan !== undefined && nuevo_plan !== null) {
      if (typeof nuevo_plan !== 'string' || !PLANES_VALIDOS.has(nuevo_plan.toLowerCase())) {
        return res.status(400).json({ error: 'nuevo_plan debe ser gratuito, free, pro o premium.' })
      }

      const plan = PLANES_VALIDOS.get(nuevo_plan.toLowerCase())
      updateFields.plan = plan
      updateFields.subscription_plan = plan === 'gratuito' ? 'free' : plan
      updateFields.is_premium = plan === 'pro' || plan === 'premium'
      updateFields.is_vip_beta = false
      if (plan === 'gratuito') updateFields.trial_ends_at = null
    }

    if (dias_extra !== undefined && dias_extra !== null) {
      const dias = Number(dias_extra)
      if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
        return res.status(400).json({ error: 'dias_extra debe ser un entero entre 1 y 3650.' })
      }

      const { data: docente, error: docenteError } = await supabaseAdmin
        .from('docentes')
        .select('trial_ends_at')
        .eq('id', docente_id)
        .maybeSingle()

      if (docenteError) throw docenteError
      if (!docente) return res.status(404).json({ error: 'Docente no encontrado.' })

      const fechaActual = docente.trial_ends_at ? new Date(docente.trial_ends_at).getTime() : 0
      const fechaBase = Math.max(Date.now(), Number.isFinite(fechaActual) ? fechaActual : 0)
      updateFields.trial_ends_at = new Date(fechaBase + dias * 24 * 60 * 60 * 1000).toISOString()
    }

    if (
      (nuevo_plan === undefined || nuevo_plan === null) &&
      (dias_extra === undefined || dias_extra === null)
    ) {
      return res.status(400).json({ error: 'Indicá nuevo_plan o dias_extra.' })
    }

    const { data, error } = await supabaseAdmin
      .from('docentes')
      .update(updateFields)
      .eq('id', docente_id)
      .select()
      .single()

    if (error?.code === 'PGRST116') return res.status(404).json({ error: 'Docente no encontrado.' })
    if (error) throw error

    res.json({ success: true, docente: data })
  } catch (err) {
    console.error('❌ Error al modificar docente desde admin:', err)
    res.status(500).json({ error: 'No se pudo modificar el docente.' })
  }
})

export default router
