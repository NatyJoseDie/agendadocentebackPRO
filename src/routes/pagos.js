import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { mpPreference, mpPayment } from '../config/mercadopago.js'
import { supabaseAdmin, supabaseForUser } from '../config/supabase.js'

const router = Router()

// 🚀 Precios de Lanzamiento (Vigencia 6 meses)
const PLANES_CONFIG = {
  pro_mensual: {
    title: 'Agenda Docente - Plan PRO (Mensual)',
    price: 3500,
    planKey: 'pro',
    diasVigencia: 30,
    ciclo: 'mensual',
  },
  pro_anual: {
    title: 'Agenda Docente - Plan PRO (Anual - ¡64% OFF Lanzamiento!)',
    price: 15000,
    planKey: 'pro',
    diasVigencia: 365,
    ciclo: 'anual',
  },
  premium_mensual: {
    title: 'Agenda Docente - Plan PREMIUM (Mensual)',
    price: 5000,
    planKey: 'premium',
    diasVigencia: 30,
    ciclo: 'mensual',
  },
  premium_anual: {
    title: 'Agenda Docente - Plan PREMIUM (Anual - ¡60% OFF Lanzamiento!)',
    price: 24000,
    planKey: 'premium',
    diasVigencia: 365,
    ciclo: 'anual',
  },
}

/**
 * POST /api/pagos/crear-preferencia
 * Genera el link de pago en Mercado Pago para el plan y ciclo elegido
 * Body: { plan: 'pro' | 'premium', ciclo: 'mensual' | 'anual' }
 */
router.post('/crear-preferencia', requireAuth, async (req, res) => {
  try {
    const { plan = 'pro', ciclo = 'anual' } = req.body

    const configKey = `${plan}_${ciclo}`
    const planSeleccionado = PLANES_CONFIG[configKey]

    if (!planSeleccionado) {
      return res.status(400).json({
        error: `Combinación inválida. Plan: ${plan}, Ciclo: ${ciclo}. Opciones válidas: pro_mensual, pro_anual, premium_mensual, premium_anual`,
      })
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'El servidor no tiene configurado MERCADO_PAGO_ACCESS_TOKEN en las variables de entorno.',
      })
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
    const backendUrl = process.env.BACKEND_PUBLIC_URL || 'http://localhost:3000'

    const preferenceData = {
      items: [
        {
          id: `plan_${configKey}`,
          title: planSeleccionado.title,
          description: `Suscripción ${planSeleccionado.ciclo} a ${planSeleccionado.title}`,
          quantity: 1,
          unit_price: Number(planSeleccionado.price),
          currency_id: 'ARS',
        },
      ],
      payer: {
        email: req.user.email,
      },
      external_reference: JSON.stringify({
        docente_id: req.user.id,
        plan: planSeleccionado.planKey,
        ciclo: planSeleccionado.ciclo,
        diasVigencia: planSeleccionado.diasVigencia,
        email: req.user.email,
      }),
      back_urls: {
        success: `${frontendUrl}/suscripcion?status=success&plan=${plan}&ciclo=${ciclo}`,
        failure: `${frontendUrl}/suscripcion?status=failure`,
        pending: `${frontendUrl}/suscripcion?status=pending`,
      },
      auto_return: 'approved',
      notification_url: `${backendUrl}/api/pagos/webhook`,
      statement_descriptor: 'AGENDA DOCENTE',
    }

    const response = await mpPreference.create({ body: preferenceData })

    res.json({
      id: response.id,
      init_point: response.init_point, // Link de producción
      sandbox_init_point: response.sandbox_init_point, // Link para pruebas
      plan: planSeleccionado.planKey,
      ciclo: planSeleccionado.ciclo,
      precio: planSeleccionado.price,
    })
  } catch (err) {
    console.error('❌ Error al crear preferencia de Mercado Pago:', err)
    res.status(500).json({ error: err.message || 'Error al comunicarse con Mercado Pago' })
  }
})

/**
 * POST /api/pagos/webhook
 * Webhook público que recibe las notificaciones instantáneas de Mercado Pago (IPN)
 */
router.post('/webhook', async (req, res) => {
  try {
    const { query, body } = req
    const topic = query.topic || query.type || body.type

    if (topic === 'payment' || body.action === 'payment.created' || body.action === 'payment.updated') {
      const paymentId = query.id || query['data.id'] || body.data?.id

      if (paymentId) {
        console.log(`🔔 Webhook Mercado Pago: procesando pago ID: ${paymentId}`)
        const paymentInfo = await mpPayment.get({ id: paymentId })

        if (paymentInfo && paymentInfo.status === 'approved') {
          console.log(`✅ Pago ${paymentId} APROBADO por $${paymentInfo.transaction_amount}`)

          let meta = {}
          try {
            meta = JSON.parse(paymentInfo.external_reference || '{}')
          } catch (e) {
            console.warn('No se pudo parsear external_reference:', paymentInfo.external_reference)
          }

          const { docente_id, plan = 'premium', diasVigencia = 365, ciclo = 'anual' } = meta

          if (docente_id) {
            const expiraAt = new Date(Date.now() + Number(diasVigencia) * 24 * 60 * 60 * 1000).toISOString()

            // 1. Actualizar docente con rol premium / pro
            const { error: updateError } = await supabaseAdmin
              .from('docentes')
              .update({
                plan: plan,
                subscription_plan: plan,
                is_premium: true,
                trial_ends_at: expiraAt,
                updated_at: new Date().toISOString(),
              })
              .eq('id', docente_id)

            if (updateError) {
              console.error('Error al actualizar plan en docentes:', updateError.message)
            } else {
              console.log(`🎉 Plan ${plan} (${ciclo}) activado con éxito para el docente ${docente_id}. Vigencia hasta: ${expiraAt}`)
            }

            // 2. Registrar el pago en la tabla pagos (si existe)
            try {
              await supabaseAdmin.from('pagos').insert({
                docente_id,
                mp_payment_id: String(paymentId),
                monto: paymentInfo.transaction_amount,
                moneda: paymentInfo.currency_id || 'ARS',
                estado: paymentInfo.status,
                metodo_pago: paymentInfo.payment_method_id,
                plan: `${plan}_${ciclo}`,
                fecha_pago: paymentInfo.date_approved || new Date().toISOString(),
                expira_at: expiraAt,
              })
            } catch (pagoErr) {
              console.warn('Aviso: no se pudo guardar en tabla pagos:', pagoErr.message)
            }
          }
        }
      }
    }

    res.status(200).send('OK')
  } catch (err) {
    console.error('❌ Error en webhook Mercado Pago:', err)
    res.status(200).send('ERROR_LOGGED')
  }
})

/**
 * GET /api/pagos/estado
 * Consulta el estado del plan y suscripción del docente autenticado
 */
router.get('/estado', requireAuth, async (req, res) => {
  try {
    const db = supabaseForUser(req.token)
    const { data: docente, error } = await db
      .from('docentes')
      .select('id, email, plan')
      .eq('id', req.user.id)
      .single()

    if (error) return res.status(500).json({ error: error.message })

    let ultimoPago = null
    try {
      const { data: pagos } = await db
        .from('pagos')
        .select('*')
        .eq('docente_id', req.user.id)
        .order('fecha_pago', { ascending: false })
        .limit(1)

      if (pagos && pagos.length > 0) {
        ultimoPago = pagos[0]
      }
    } catch (_) {
      // Ignorar si la tabla pagos aún no está creada
    }

    res.json({
      plan: docente?.plan || 'gratuito',
      is_premium: docente?.plan === 'pro' || docente?.plan === 'premium',
      ultimoPago,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
