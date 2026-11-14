import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { mpPreference, mpPayment } from '../config/mercadopago.js'
import { supabaseAdmin, supabaseForUser } from '../config/supabase.js'
import { verifyMercadoPagoSignature } from '../utils/mercadopagoWebhook.js'

const router = Router()

const PLAN_IDS = [
  'pro_mensual', 'pro_ciclo_lectivo',
  'premium_mensual', 'premium_ciclo_lectivo',
  'basico_mensual', 'basico_ciclo_lectivo'
]
const VALID_PLANS = new Set(['pro', 'premium', 'basico'])
const VALID_CICLOS = new Set(['mensual', 'ciclo_lectivo'])

async function fetchPlanesFromDB() {
  const { data, error } = await supabaseAdmin
    .from('planes_precios')
    .select('id, plan, ciclo, titulo, precio, precio_promocional, promo_hasta, activo')
    .in('id', PLAN_IDS)
    .order('plan', { ascending: true })
    .order('ciclo', { ascending: true })

  if (error) throw error
  return data || []
}

function calcularPrecioVigente(plan) {
  const ahora = new Date()
  const enPromocion = plan.activo && plan.precio_promocional && plan.promo_hasta && new Date(plan.promo_hasta) > ahora
  return {
    ...plan,
    en_promocion: enPromocion,
    precio_vigente: enPromocion ? Number(plan.precio_promocional) : Number(plan.precio),
  }
}

function calcularExpiraCicloLectivo(fechaPago) {
  const fp = new Date(fechaPago)
  const mes = fp.getMonth() + 1
  const anio = fp.getFullYear()

  let finCiclo
  if (mes >= 10) {
    finCiclo = new Date(anio + 1, 11, 31, 23, 59, 59)
  } else {
    finCiclo = new Date(anio, 11, 31, 23, 59, 59)
  }
  return finCiclo.toISOString()
}

/**
 * GET /api/pagos/planes (público)
 * Devuelve los 4 planes con precios vigentes y estado de promoción
 */
router.get('/planes', async (_req, res) => {
  try {
    const planes = await fetchPlanesFromDB()
    const planesConPrecio = planes.map(calcularPrecioVigente)
    res.json({ planes: planesConPrecio })
  } catch (err) {
    console.error('❌ Error al obtener planes:', err)
    res.status(500).json({ error: 'No se pudieron obtener los planes.' })
  }
})

/**
 * POST /api/pagos/crear-preferencia
 * Genera el link de pago en Mercado Pago para el plan y ciclo elegido
 * Body: { plan: 'pro'|'premium'|'basico', ciclo: 'mensual'|'ciclo_lectivo' }
 */
router.post('/crear-preferencia', (req, _res, next) => {
  req.skipSubscriptionWriteCheck = true
  next()
}, requireAuth, async (req, res) => {
  try {
    const { plan = 'pro', ciclo = 'ciclo_lectivo' } = req.body || {}

    if (!VALID_PLANS.has(plan) || !VALID_CICLOS.has(ciclo)) {
      return res.status(400).json({
        error: `Combinación inválida. Plan: ${plan}, Ciclo: ${ciclo}. Opciones válidas: basico_mensual, basico_ciclo_lectivo, pro_mensual, pro_ciclo_lectivo, premium_mensual, premium_ciclo_lectivo`,
      })
    }

    const planes = await fetchPlanesFromDB()
    const planDB = planes.find(p => p.plan === plan && p.ciclo === ciclo && p.activo)
    if (!planDB) {
      return res.status(404).json({ error: 'Plan no encontrado o inactivo.' })
    }

    const { en_promocion, precio_vigente } = calcularPrecioVigente(planDB)

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

    let diasVigencia
    let expiraAtParaRPC = null

    if (ciclo === 'mensual') {
      diasVigencia = 30
    } else {
      const ahora = new Date()
      diasVigencia = Math.ceil((new Date(calcularExpiraCicloLectivo(ahora)) - ahora) / (1000 * 60 * 60 * 24))
      expiraAtParaRPC = calcularExpiraCicloLectivo(ahora)
    }

    const preferenceData = {
      items: [
        {
          id: `plan_${plan}_${ciclo}`,
          title: planDB.titulo,
          description: `Suscripción ${ciclo} a ${planDB.titulo}`,
          quantity: 1,
          unit_price: precio_vigente,
          currency_id: 'ARS',
        },
      ],
      payer: {
        email: req.user.email,
      },
      external_reference: JSON.stringify({
        docente_id: req.user.id,
        plan,
        ciclo,
        diasVigencia,
        expira_at: expiraAtParaRPC,
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

    await supabaseAdmin
      .from('intenciones_pago')
      .insert({
        docente_id: req.user.id,
        plan,
        ciclo,
        precio: precio_vigente,
        mp_preference_id: response.id,
      })

    res.json({
      id: response.id,
      init_point: checkoutUrl,
      checkout_url: checkoutUrl,
      sandbox_init_point: response.sandbox_init_point,
      plan,
      ciclo,
      precio: precio_vigente,
      en_promocion,
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

        const { docente_id, plan, ciclo, diasVigencia, expira_at } = meta || {}

        if (
          typeof docente_id !== 'string' ||
          !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(docente_id) ||
          !VALID_PLANS.has(plan) ||
          !VALID_CICLOS.has(ciclo) ||
          typeof diasVigencia !== 'number' ||
          Number(paymentInfo.transaction_amount) <= 0 ||
          paymentInfo.currency_id !== 'ARS'
        ) {
          console.error(`❌ El pago ${paymentId} no coincide con un plan, precio o moneda válidos.`)
          return res.status(200).send('Pago no válido')
        }

        const planes = await fetchPlanesFromDB()
        const planDB = planes.find(p => p.plan === plan && p.ciclo === ciclo && p.activo)
        if (!planDB) {
          console.error(`❌ Plan ${plan}_${ciclo} no encontrado o inactivo.`)
          return res.status(200).send('Plan no válido')
        }

        const { precio_vigente } = calcularPrecioVigente(planDB)
        if (Number(paymentInfo.transaction_amount) !== precio_vigente) {
          console.error(`❌ El pago ${paymentId} monto ${paymentInfo.transaction_amount} ≠ precio vigente ${precio_vigente}.`)
          return res.status(200).send('Monto no válido')
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
            p_dias: diasVigencia,
            p_expira_at: expira_at || null,
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