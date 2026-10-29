import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../config/supabase.js'

const router = Router()

const ADMIN_EMAILS = [
  'nbarzotti6@gmail.com',
  'natalia@agendadocente.com',
  'admin@agendadocente.com',
]

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
      .select('*')
      .order('created_at', { ascending: false })

    if (errDocentes) throw errDocentes

    // 2. Obtener todos los pagos
    let pagos = []
    try {
      const { data: pagosData } = await supabaseAdmin
        .from('pagos')
        .select('*')
        .order('fecha_pago', { ascending: false })
      pagos = pagosData || []
    } catch (_) {
      // Ignorar si la tabla pagos aún está vacía
    }

    // 3. Calcular ingresos totales aprobados
    const pagosAprobados = pagos.filter(p => p.estado === 'approved')
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
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/admin/modificar-docente
 * Permite a Natalia cambiar el plan o agregar días a cualquier usuario manualmente
 */
router.post('/modificar-docente', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { docente_id, nuevo_plan, dias_extra } = req.body

    if (!docente_id) {
      return res.status(400).json({ error: 'Falta docente_id' })
    }

    const updateFields = { updated_at: new Date().toISOString() }

    if (nuevo_plan) {
      updateFields.plan = nuevo_plan
      updateFields.subscription_plan = nuevo_plan
      updateFields.is_premium = nuevo_plan !== 'gratuito' && nuevo_plan !== 'free'
    }

    if (dias_extra) {
      const nuevaFecha = new Date(Date.now() + Number(dias_extra) * 24 * 60 * 60 * 1000).toISOString()
      updateFields.trial_ends_at = nuevaFecha
    }

    const { data, error } = await supabaseAdmin
      .from('docentes')
      .update(updateFields)
      .eq('id', docente_id)
      .select()
      .single()

    if (error) throw error

    res.json({ success: true, docente: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
