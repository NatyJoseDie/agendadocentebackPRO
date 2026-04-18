import 'dotenv/config'
import app from './app.js'

const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
  console.log(`\n🚀 Agenda Docente API corriendo en http://localhost:${PORT}`)
  console.log(`📚 Entorno: ${process.env.NODE_ENV || 'development'}\n`)
})
