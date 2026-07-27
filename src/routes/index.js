import { Router } from 'express'
import docentesRouter from './docentes.js'
import escuelasRouter from './escuelas.js'
import cursosRouter from './cursos.js'
import horariosRouter from './horarios.js'
import alumnosRouter from './alumnos.js'
import asistenciasRouter from './asistencias.js'
import calificacionesRouter from './calificaciones.js'
import calendarioRouter from './calendario.js'
import planificacionesRouter from './planificaciones.js'
import proyectosRouter from './proyectos.js'
import salidasRouter from './salidas.js'
import necesidadesRouter from './necesidades.js'
import contactosRouter from './contactos.js'
import licenciasRouter from './licencias.js'
import libroTemasRouter from './libro_temas.js'
import ocrRouter from './ocr.js'

const router = Router()

router.use('/docentes', docentesRouter)
router.use('/escuelas', escuelasRouter)
router.use('/cursos', cursosRouter)
router.use('/horarios', horariosRouter)
router.use('/alumnos', alumnosRouter)
router.use('/asistencias', asistenciasRouter)
router.use('/calificaciones', calificacionesRouter)
router.use('/calendario', calendarioRouter)
router.use('/planificaciones', planificacionesRouter)
router.use('/proyectos', proyectosRouter)
router.use('/salidas', salidasRouter)
router.use('/necesidades', necesidadesRouter)
router.use('/contactos', contactosRouter)
router.use('/licencias', licenciasRouter)
router.use('/libro-temas', libroTemasRouter)
router.use('/ocr', ocrRouter)

export default router
