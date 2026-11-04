import { supabaseAdmin } from '../config/supabase.js'

const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000
const PAID_PLANS = new Set(['pro', 'premium'])

export const requireWritable = async (req, res, next) => {
  try {
    const { data: docente, error } = await supabaseAdmin
      .from('docentes')
      .select('id, plan, subscription_plan, trial_ends_at')
      .eq('id', req.user.id)
      .maybeSingle()

    if (error) throw error
    if (!docente) return next()

    const tienePlanPago =
      PAID_PLANS.has(docente.plan) || PAID_PLANS.has(docente.subscription_plan)

    if (!tienePlanPago || !docente.trial_ends_at) return next()

    const fechaVencimiento = new Date(docente.trial_ends_at)
    if (Number.isNaN(fechaVencimiento.getTime())) {
      throw new Error(`Fecha de vencimiento inválida para el docente ${docente.id}`)
    }

    const ahora = Date.now()
    if (fechaVencimiento.getTime() > ahora) return next()

    if (ahora - fechaVencimiento.getTime() >= GRACE_PERIOD_MS) {
      const { error: updateError } = await supabaseAdmin
        .from('docentes')
        .update({
          plan: 'gratuito',
          subscription_plan: 'free',
          is_premium: false,
          trial_ends_at: null,
          updated_at: new Date(ahora).toISOString(),
        })
        .eq('id', docente.id)

      if (updateError) throw updateError
      return next()
    }

    return res.status(423).json({
      error: 'La suscripción venció. La cuenta está en modo de solo lectura durante el período de gracia.',
      code: 'READ_ONLY_GRACE_PERIOD',
      trial_ends_at: docente.trial_ends_at,
    })
  } catch (error) {
    console.error('Error al verificar permisos de escritura:', error)
    return res.status(500).json({ error: 'No se pudo verificar el estado de la suscripción.' })
  }
}
