import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { mpPreference, mpPayment } from '../config/mercadopago.js'
import { supabaseAdmin, supabaseForUser } from '../config/supabase.js'
import { verifyMercadoPagoSignature } from '../utils/mercadopagoWebhook.js'

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
router.post('/crear-preferencia', (req, _res, next) => {
  req.skipSubscriptionWriteCheck = true
  next()
}, requireAuth, async (req, res) => {
  try {
    const { plan = 'pro', ciclo = 'anual' } = req.body || {}

    const configKey = `${plan}_${ciclo}`
    const planSeleccionado = PLANES_CONFIG[configKey]

    if (!planSeleccionado) {
      return res.status(400).json({
        error: `Combinación inválida. Plan: ${plan}, Ciclo: ${ciclo}. Opciones válidas: pro_mensual, pro_anual, premium_mensual, premium_anual`,
      })
    }

    if (!process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      return res.status(503).json({
        error: 'Pagos no disponibles: falta configurar las credenciales de Mercado Pago.',
      })
    }

    const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '')
    const backendUrl = process.env.BACKEND_PUBLIC_URL?.replace(/\/+$/, '')
    const environment = process.env.MERCADO_PAGO_ENVIRONMENT

    if (!frontendUrl || !backendUrl || !['sandbox', 'production'].includes(environment)) {
      return res.status(503).json({
        error: 'Pagos no disponibles: configurá FRONTEND_URL, BACKEND_PUBLIC_URL y MERCADO_PAGO_ENVIRONMENT.',
      })
    }

    if (process.env.NODE_ENV === 'production' && (
      !frontendUrl.startsWith('https://') || !backendUrl.startsWith('https://')
    )) {
      return res.status(503).json({ error: 'Las URL públicas de pagos deben usar HTTPS en producción.' })
    }

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
    const checkoutUrl = environment === 'sandbox'
      ? response.sandbox_init_point
      : response.init_point

    if (!checkoutUrl) {
      console.error(`Mercado Pago no devolvió una URL de checkout para el entorno ${environment}.`)
      return res.status(502).json({ error: 'Mercado Pago no generó el enlace de pago.' })
    }

    res.json({
      id: response.id,
      init_point: checkoutUrl,
      checkout_url: checkoutUrl,
      sandbox_init_point: response.sandbox_init_point,
      plan: planSeleccionado.planKey,
      ciclo: planSeleccionado.ciclo,
      precio: planSeleccionado.price,
    })
  } catch (err) {
    console.error('❌ Error al crear preferencia de Mercado Pago:', err)
    res.status(502).json({ error: 'No se pudo iniciar el pago. Intentá nuevamente.' })
  }
})

/**
 * POST /api/pagos/webhook
 * Webhook público que recibe las notificaciones instantáneas de Mercado Pago (IPN)
 */
router.post('/webhook', async (req, res) => {
  try {
    const { query, body } = req
    const topic = query.topic || query.type || body?.type
    const action = body?.action
    const isPaymentNotification =
      topic === 'payment' ||
      action === 'payment.created' ||
      action === 'payment.updated'

    if (isPaymentNotification) {
      const paymentId = body?.data?.id || query['data.id'] || query.id
      const requestId = req.get('x-request-id')
      const signature = req.get('x-signature')
      const webhookSecret = process.env.MERCADO_PAGO_WEBHOOK_SECRET

      if (!webhookSecret) {
        console.error('❌ MERCADO_PAGO_WEBHOOK_SECRET no está configurado.')
        return res.status(503).send('Webhook no configurado')
      }

      if (!verifyMercadoPagoSignature({
        secret: webhookSecret,
        signature,
        requestId,
        dataId: paymentId,
      })) {
        console.warn('⚠️ Webhook de Mercado Pago rechazado: firma inválida.')
        return res.status(401).send('Firma inválida')
      }

      if (!paymentId) return res.status(400).send('Falta el ID del pago')

      console.log(`🔔 Webhook Mercado Pago: procesando pago ID: ${paymentId}`)
      const paymentInfo = await mpPayment.get({ id: paymentId })

      if (paymentInfo?.status === 'approved') {
        let meta

        try {
          meta = JSON.parse(paymentInfo.external_reference || '')
        } catch {
          console.error(`❌ El pago ${paymentId} tiene una referencia externa inválida.`)
          return res.status(200).send('Referencia inválida')
        }

        const { docente_id, plan, ciclo, diasVigencia } = meta || {}
        const config = PLANES_CONFIG[`${plan}_${ciclo}`]

        if (
          typeof docente_id !== 'string' ||
          !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(docente_id) ||
          !config ||
          Number(diasVigencia) !== config.diasVigencia ||
          Number(paymentInfo.transaction_amount) !== config.price ||
          paymentInfo.currency_id !== 'ARS'
        ) {
          console.error(`❌ El pago ${paymentId} no coincide con un plan, precio o moneda válidos.`)
          return res.status(200).send('Pago no válido')
        }

        const fechaPago = paymentInfo.date_approved || paymentInfo.date_created || new Date().toISOString()
        if (Number.isNaN(new Date(fechaPago).getTime())) {
          throw new Error(`El pago ${paymentId} tiene una fecha de aprobación inválida.`)
        }

        const { data: expiraAt, error: activacionError } = await supabaseAdmin.rpc(
          'activar_pago_suscripcion',
          {
            p_docente_id: docente_id,
            p_payment_id: String(paymentId),
            p_monto: Number(paymentInfo.transaction_amount),
            p_moneda: paymentInfo.currency_id,
            p_estado: paymentInfo.status,
            p_metodo_pago: paymentInfo.payment_method_id || null,
            p_plan: plan,
            p_ciclo: ciclo,
            p_fecha_pago: fechaPago,
            p_dias: config.diasVigencia,
          },
        )

        if (activacionError?.code === 'P0002') {
          console.error(`❌ El pago ${paymentId} corresponde a un docente inexistente.`)
          return res.status(200).send('Docente inexistente')
        }
        if (activacionError) throw activacionError
        console.log(`✅ Plan ${plan} (${ciclo}) activado para ${docente_id} hasta ${expiraAt}.`)
      }
    }

    res.status(200).send('OK')
  } catch (err) {
    console.error('❌ Error en webhook Mercado Pago:', err)
    res.status(500).send('No se pudo procesar la notificación')
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

    const { data: pagos, error: pagosError } = await db
      .from('pagos')
      .select('mp_payment_id, monto, moneda, estado, plan, fecha_pago, expira_at')
      .eq('docente_id', req.user.id)
      .order('fecha_pago', { ascending: false })
      .limit(1)

    if (pagosError) return res.status(500).json({ error: pagosError.message })

    res.json({
      plan: docente?.plan || 'gratuito',
      is_premium: docente?.plan === 'pro' || docente?.plan === 'premium',
      ultimoPago: pagos?.[0] || null,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
