import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../config/supabase.js'
import { estadoDocenteAdmin } from '../utils/metricasAdmin.js'

const router = Router()

const PLANES_VALIDOS = new Map([
  ['gratuito', 'gratuito'],
  ['free', 'gratuito'],
  ['basico', 'basico'],
  ['pro', 'pro'],
  ['premium', 'premium'],
])

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || [
  'nbarzotti6@gmail.com',
  'natalia@agendadocente.com',
  'admin@agendadocente.com',
].join(','))
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean)

function perfilEsAdmin(perfil = {}) {
  if (!perfil || typeof perfil !== 'object') return false

  const rol = String(perfil.rol || '').trim().toLowerCase()
  const isAdminFlag = Boolean(perfil.is_admin)

  return isAdminFlag || rol === 'admin' || rol === 'super_admin' || rol === 'fundadora'
}

async function esUsuarioAdminDesdeDb({ id, email }) {
  const safeEmail = email?.trim().toLowerCase()

  if (safeEmail && ADMIN_EMAILS.includes(safeEmail)) {
    return true
  }

  try {
    const consultas = []

    if (id) {
      consultas.push({ tabla: 'docentes', query: supabaseAdmin.from('docentes').select('id, email, is_admin').eq('id', id).maybeSingle() })
      consultas.push({ tabla: 'users', query: supabaseAdmin.from('users').select('id, email, is_admin').eq('id', id).maybeSingle() })
    }

    if (safeEmail) {
      consultas.push({ tabla: 'docentes', query: supabaseAdmin.from('docentes').select('id, email, is_admin').ilike('email', safeEmail).maybeSingle() })
      consultas.push({ tabla: 'users', query: supabaseAdmin.from('users').select('id, email, is_admin').ilike('email', safeEmail).maybeSingle() })
    }

    for (const consulta of consultas) {
      const result = await consulta.query
      if (result?.data && perfilEsAdmin(result.data)) return true
      if (result?.error && result.error.code !== '42703' && result.error.code !== 'PGRST116') {
        console.warn(`⚠️ Error consultando admin en ${consulta.tabla}:`, result.error)
      }
    }

    return false
  } catch (error) {
    console.error('❌ Error al verificar admin en la base:', error)
    return false
  }
}

const requireAdmin = async (req, res, next) => {
  const email = req.user?.email?.toLowerCase()
  const id = req.user?.id

  if (!email && !id) {
    return res.status(403).json({ error: 'Acceso denegado: sesión inválida.' })
  }

  try {
    const isAdmin = await esUsuarioAdminDesdeDb({ id, email })
    if (!isAdmin) {
      return res.status(403).json({ error: 'Acceso denegado: solo disponible para administradores.' })
    }
    next()
  } catch (error) {
    console.error('❌ Error al verificar permisos de admin:', error)
    return res.status(500).json({ error: 'No se pudo verificar el permiso de administrador.' })
  }
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
      .select('id, email, nombre, apellido, avatar_url, plan, subscription_plan, is_premium, is_vip_beta, trial_ends_at, created_at')
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
    let countBasico = 0
    let countFree = 0
    let countVencidos = 0

    const listaDocentes = (docentes || []).map(d => {
      const isOwner = perfilEsAdmin(d)
      const { estado, diasRestantes } = estadoDocenteAdmin(d, isOwner, now)
      if (estado === 'vencido') countVencidos++
      else if (estado === 'vip_beta') countVip++
      else if (estado === 'premium') countPremium++
      else if (estado === 'pro') countPro++
      else if (estado === 'basico') countBasico++
      else if (estado === 'free') countFree++

      return {
        id: d.id,
        email: d.email,
        nombre: d.nombre || 'Docente',
        apellido: d.apellido || '',
        avatar_url: d.avatar_url,
        plan: d.plan,
        subscription_plan: d.subscription_plan,
        is_premium: d.is_premium,
        is_vip_beta: d.is_vip_beta,
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
        countBasico,
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
        return res.status(400).json({ error: 'nuevo_plan debe ser gratuito, free, basico, pro o premium.' })
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

const PLAN_IDS = [
  'pro_mensual', 'pro_ciclo_lectivo',
  'premium_mensual', 'premium_ciclo_lectivo',
  'basico_mensual', 'basico_ciclo_lectivo'
]

function calcularPrecioVigente(plan) {
  const ahora = new Date()
  const enPromocion = plan.activo && plan.precio_promocional && plan.promo_hasta && new Date(plan.promo_hasta) > ahora
  return {
    ...plan,
    en_promocion: enPromocion,
    precio_vigente: enPromocion ? Number(plan.precio_promocional) : Number(plan.precio),
  }
}

async function fetchPlanesWithConfig() {
  const [planesRes, configRes] = await Promise.all([
    supabaseAdmin
      .from('planes_precios')
      .select('id, plan, ciclo, titulo, precio, precio_promocional, promo_hasta, activo, updated_at, updated_by')
      .in('id', PLAN_IDS)
      .order('plan', { ascending: true })
      .order('ciclo', { ascending: true }),
    supabaseAdmin
      .from('configuracion_precios')
      .select('ultimo_ajuste_at, meses_recordatorio')
      .eq('id', true)
      .maybeSingle(),
  ])

  if (planesRes.error) throw planesRes.error
  if (configRes.error) throw configRes.error

  const planes = (planesRes.data || []).map(calcularPrecioVigente)
  const config = configRes.data || { ultimo_ajuste_at: new Date().toISOString(), meses_recordatorio: 6 }

  const ultimoAjuste = new Date(config.ultimo_ajuste_at)
  const proximoAjuste = new Date(ultimoAjuste)
  proximoAjuste.setMonth(proximoAjuste.getMonth() + config.meses_recordatorio)
  const ahora = new Date()
  const ajustePendiente = proximoAjuste <= ahora

  const recordatorio = {
    ultimo_ajuste_at: config.ultimo_ajuste_at,
    proximo_ajuste_at: proximoAjuste.toISOString(),
    meses_recordatorio: config.meses_recordatorio,
    ajuste_pendiente: ajustePendiente,
  }

  return { planes, recordatorio }
}

/**
 * GET /api/admin/precios (auth, solo admin)
 * Devuelve planes con precios vigentes y config de recordatorio
 */
router.get('/precios', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { planes, recordatorio } = await fetchPlanesWithConfig()
    res.json({ planes, recordatorio })
  } catch (err) {
    console.error('❌ Error al obtener precios de admin:', err)
    res.status(500).json({ error: 'No se pudieron obtener los precios.' })
  }
})

/**
 * PUT /api/admin/precios (auth, solo admin)
 * Actualiza precios, promociones, estado activo y meses de recordatorio
 * Body: { planes: [{ id, precio?, precio_promocional?, promo_hasta?, activo? }], meses_recordatorio? }
 */
router.put('/precios', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { planes: planesInput = [], meses_recordatorio } = req.body || {}

    if (!Array.isArray(planesInput) || planesInput.length === 0) {
      return res.status(400).json({ error: 'Se requiere un array "planes" con al menos un elemento.' })
    }

    const errores = []
    for (const p of planesInput) {
      if (!PLAN_IDS.includes(p.id)) {
        errores.push(`ID de plan inválido: ${p.id}`)
        continue
      }
      if (p.precio !== undefined && (typeof p.precio !== 'number' || p.precio <= 0)) {
        errores.push(`Precio inválido para ${p.id}: debe ser número > 0`)
      }
      if (p.precio_promocional !== null && p.precio_promocional !== undefined &&
          (typeof p.precio_promocional !== 'number' || p.precio_promocional <= 0)) {
        errores.push(`Precio promocional inválido para ${p.id}: debe ser número > 0 o null`)
      }
      if (p.promo_hasta !== null && p.promo_hasta !== undefined) {
        const fecha = new Date(p.promo_hasta)
        if (Number.isNaN(fecha.getTime())) {
          errores.push(`promo_hasta inválido para ${p.id}: debe ser ISO 8601 o null`)
        }
      }
      if (p.activo !== undefined && typeof p.activo !== 'boolean') {
        errores.push(`activo inválido para ${p.id}: debe ser boolean`)
      }
    }

    if (meses_recordatorio !== undefined) {
      if (!Number.isInteger(meses_recordatorio) || meses_recordatorio < 1 || meses_recordatorio > 24) {
        errores.push('meses_recordatorio debe ser entero entre 1 y 24')
      }
    }

    if (errores.length > 0) {
      return res.status(400).json({ error: errores.join('; ') })
    }

    const ahora = new Date().toISOString()
    const email = req.user?.email || 'admin'

    for (const p of planesInput) {
      const updateFields = { updated_at: ahora, updated_by: email }
      if (p.precio !== undefined) updateFields.precio = p.precio
      if (p.precio_promocional !== undefined) updateFields.precio_promocional = p.precio_promocional
      if (p.promo_hasta !== undefined) updateFields.promo_hasta = p.promo_hasta
      if (p.activo !== undefined) updateFields.activo = p.activo

      const { error } = await supabaseAdmin
        .from('planes_precios')
        .update(updateFields)
        .eq('id', p.id)

      if (error) throw error
    }

    if (meses_recordatorio !== undefined) {
      const { error } = await supabaseAdmin
        .from('configuracion_precios')
        .update({ meses_recordatorio, updated_by: email })
        .eq('id', true)
      if (error) throw error
    }

    const { planes, recordatorio } = await fetchPlanesWithConfig()
    res.json({ success: true, planes, recordatorio })
  } catch (err) {
    console.error('❌ Error al actualizar precios:', err)
    res.status(500).json({ error: 'No se pudieron actualizar los precios.' })
  }
})

export default router
