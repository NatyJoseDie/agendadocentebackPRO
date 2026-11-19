import { supabaseAdmin } from '../config/supabase.js'

const DIA_MS = 24 * 60 * 60 * 1000
const MAX_DIAS_PREVIOS = 60
const ZONA = 'America/Argentina/Buenos_Aires'

const fechaLocal = (fecha) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(fecha)
const diasEntreFechas = (desde, hasta) => Math.round((Date.parse(hasta) - Date.parse(desde)) / DIA_MS)
const formatoAr = (fecha) => fecha.split('-').reverse().join('/')

function textoAnticipacion(dias) {
  if (dias <= 0) return 'Hoy'
  if (dias === 1) return 'Mañana'
  return `En ${dias} días`
}

async function crearAviso({ docenteId, claveEvento, fecha, diasPrevios, ahora, titulo, mensaje }) {
  const diasRestantes = diasEntreFechas(fechaLocal(ahora), fecha)
  // Solo cuando ya llegó el momento de avisar y el evento no pasó
  if (diasRestantes < 0 || diasRestantes > diasPrevios) return false

  const { data, error } = await supabaseAdmin
    .from('notificaciones_docente')
    .upsert({
      docente_id: docenteId,
      event_key: `${claveEvento}:${fecha}:${diasPrevios}`,
      tipo: 'evento_calendario',
      titulo: `${textoAnticipacion(diasRestantes)}: ${titulo}`,
      mensaje,
      programada_para: ahora.toISOString(),
      push_estado: 'pendiente',
      email_estado: 'enviada',
    }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('id')

  if (error) throw error
  return Boolean(data?.length)
}

const limitarDias = (dias, porDefecto) => Math.min(Math.max(dias ?? porDefecto, 0), MAX_DIAS_PREVIOS)

/**
 * Crea una notificación (push + badge) por cada evento académico o salida con
 * alarma cuyo momento de aviso (fecha - días previos) ya llegó.
 * event_key evita duplicados.
 */
export async function procesarAvisosCalendario(ahora = new Date()) {
  const hoy = fechaLocal(ahora)
  const hasta = fechaLocal(new Date(ahora.getTime() + (MAX_DIAS_PREVIOS + 1) * DIA_MS))
  let creadas = 0
  let errores = 0

  const [eventos, salidas] = await Promise.all([
    supabaseAdmin
      .from('eventos_academicos')
      .select('id, docente_id, titulo, tipo, fecha, dias_previos, cursos(nombre)')
      .eq('alarma', true)
      .not('docente_id', 'is', null)
      .gte('fecha', new Date(ahora.getTime() - DIA_MS).toISOString())
      .lte('fecha', new Date(ahora.getTime() + (MAX_DIAS_PREVIOS + 2) * DIA_MS).toISOString())
      .limit(1000),
    supabaseAdmin
      .from('salidas')
      .select('id, docente_id, nombre_proyecto, destino, fecha_salida, dias_previos_aviso, estado, cursos(nombre)')
      .eq('recordatorio_habilitado', true)
      .gte('fecha_salida', hoy)
      .lte('fecha_salida', hasta)
      .limit(1000),
  ])

  if (eventos.error) {
    errores++
    console.error('❌ [Avisos calendario] Error al consultar eventos:', eventos.error.message)
  }
  if (salidas.error) {
    errores++
    console.error('❌ [Avisos calendario] Error al consultar salidas:', salidas.error.message)
  }

  for (const evento of eventos.data || []) {
    try {
      const fecha = fechaLocal(new Date(evento.fecha))
      const curso = evento.cursos?.nombre ? ` – ${evento.cursos.nombre}` : ''
      const creada = await crearAviso({
        docenteId: evento.docente_id,
        claveEvento: `evento:${evento.id}`,
        fecha,
        diasPrevios: limitarDias(evento.dias_previos, 1),
        ahora,
        titulo: evento.tipo || 'Evento',
        mensaje: `${evento.titulo}${curso} (${formatoAr(fecha)})`,
      })
      if (creada) creadas++
    } catch (error) {
      errores++
      console.error(`❌ [Avisos calendario] Evento ${evento.id}:`, error.message)
    }
  }

  for (const salida of salidas.data || []) {
    if (['cancelada', 'realizada'].includes(salida.estado)) continue
    try {
      const destino = salida.destino ? ` a ${salida.destino}` : ''
      const curso = salida.cursos?.nombre ? ` – ${salida.cursos.nombre}` : ''
      const creada = await crearAviso({
        docenteId: salida.docente_id,
        claveEvento: `salida:${salida.id}`,
        fecha: salida.fecha_salida,
        diasPrevios: limitarDias(salida.dias_previos_aviso, 2),
        ahora,
        titulo: 'Salida educativa',
        mensaje: `${salida.nombre_proyecto}${destino}${curso} (${formatoAr(salida.fecha_salida)})`,
      })
      if (creada) creadas++
    } catch (error) {
      errores++
      console.error(`❌ [Avisos calendario] Salida ${salida.id}:`, error.message)
    }
  }

  return { creadas, errores }
}
