import express from 'express'
import cors from 'cors'
import routes from './routes/index.js'

const app = express()

// ── Middlewares globales ──────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(express.json())

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'Agenda Docente API', version: '1.0.0' })
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
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' })
})

export default app
