import express from 'express'
import cors from 'cors'
import routes from './routes/index.js'
import { supabaseAdmin } from './config/supabase.js'

const app = express()
const allowedOrigins = (process.env.CORS_ORIGIN || (
  process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173'
))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (process.env.NODE_ENV === 'production' && (
  allowedOrigins.length === 0 || allowedOrigins.includes('*')
)) {
  throw new Error('En producción, CORS_ORIGIN debe contener los dominios permitidos y no puede ser "*".')
}

// ── Middlewares globales ──────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(null, false)
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json({ limit: '1mb' }))

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Agenda Docente API', version: '1.0.0' })
})

app.get('/api/health/ready', async (_req, res) => {
  try {
    const [docentes, pagos, notificaciones] = await Promise.all([
      supabaseAdmin
        .from('docentes')
        .select('id, plan, subscription_plan, is_premium, is_vip_beta, trial_ends_at', { head: true })
        .limit(0),
      supabaseAdmin
        .from('pagos')
        .select('mp_payment_id, expira_at', { head: true })
        .limit(0),
      supabaseAdmin
        .from('notificaciones_docente')
        .select('id, leida_at, email_estado', { head: true })
        .limit(0),
    ])

    if (docentes.error) throw docentes.error
    if (pagos.error) throw pagos.error
    if (notificaciones.error) throw notificaciones.error

    const { error: rpcError } = await supabaseAdmin.rpc('activar_pago_suscripcion', {
      p_docente_id: null,
      p_payment_id: null,
      p_monto: null,
      p_moneda: null,
      p_estado: null,
      p_metodo_pago: null,
      p_plan: null,
      p_ciclo: null,
      p_fecha_pago: null,
      p_dias: null,
    })

    if (rpcError?.code !== '22023') {
      throw rpcError || new Error('La función de activación de pagos no validó la solicitud de prueba.')
    }

    res.json({
      status: 'ready',
      database: 'ok',
      subscriptionPayments: 'ok',
      vipNotifications: 'ok',
    })
  } catch (error) {
    console.error('❌ La API no está lista: falló la conexión con Supabase:', error.message)
    res.status(503).json({ status: 'unavailable' })
  }
})

// ── Rutas de la API ───────────────────────────────────────────
app.use('/api', routes)

// ── Manejo de rutas no encontradas ───────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' })
})

// ── Manejo global de errores ──────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('❌ Error:', err.message)
  let status = err.status || err.statusCode || 500
  if (err.code === 'LIMIT_FILE_SIZE') status = 413
  if (err.code === 'LIMIT_UNEXPECTED_FILE') status = 400
  const message = status >= 500 ? 'Error interno del servidor' : err.message
  res.status(status).json({ error: message })
})

export default app
