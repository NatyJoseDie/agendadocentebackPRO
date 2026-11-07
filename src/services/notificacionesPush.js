import { sendNotification, setVapidDetails } from 'web-push'
import { supabaseAdmin } from '../config/supabase.js'
import {
  crearPayloadPush,
  obtenerConfiguracionVapid,
  obtenerProximoReintento,
} from '../utils/webPush.js'

const MAX_INTENTOS_PUSH = 5
const MAX_ENTREGAS_POR_CICLO = 50
const ENVIO_ATASCADO_MS = 15 * 60 * 1000
let configuracionAplicada

export function obtenerClavePublicaVapid() {
  const configuracion = obtenerConfiguracionVapid()
  return configuracion?.publicKey || null
}

function configurarWebPush() {
  const configuracion = obtenerConfiguracionVapid()
  if (!configuracion) return false

  const fingerprint = `${configuracion.publicKey}:${configuracion.privateKey}:${configuracion.subject}`
  if (configuracionAplicada !== fingerprint) {
    setVapidDetails(
      configuracion.subject,
      configuracion.publicKey,
      configuracion.privateKey,
    )
    configuracionAplicada = fingerprint
  }

  return true
}

async function actualizarEstadoNotificacion(notificacionId) {
  const { data: entregas, error: consultaError } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .select('estado')
    .eq('notificacion_id', notificacionId)

  if (consultaError) throw consultaError
  if (!entregas?.length) return

  const todosTerminales = entregas.every((entrega) =>
    ['enviada', 'expirada'].includes(entrega.estado),
  )
  const estado = todosTerminales
    ? (entregas.some((entrega) => entrega.estado === 'enviada') ? 'enviada' : 'fallida')
    : (entregas.some((entrega) => entrega.estado === 'fallida') ? 'fallida' : 'pendiente')

  const { error } = await supabaseAdmin
    .from('notificaciones_docente')
    .update({ push_estado: estado })
    .eq('id', notificacionId)

  if (error) throw error
}

async function encolarNotificacion(notificacion) {
  const ahora = new Date().toISOString()
  const { data: suscripciones, error: suscripcionesError } = await supabaseAdmin
    .from('push_suscripciones')
    .select('id')
    .eq('docente_id', notificacion.docente_id)
    .or(`expiration_time.is.null,expiration_time.gt.${ahora}`)

  if (suscripcionesError) throw suscripcionesError

  if (!suscripciones?.length) {
    const { error } = await supabaseAdmin
      .from('notificaciones_docente')
      .update({
        push_estado: 'sin_suscripciones',
        push_enqueued_at: ahora,
      })
      .eq('id', notificacion.id)
      .is('push_enqueued_at', null)

    if (error) throw error
    return 0
  }

  const entregas = suscripciones.map((suscripcion) => ({
    notificacion_id: notificacion.id,
    suscripcion_id: suscripcion.id,
    estado: 'pendiente',
    proximo_intento_at: ahora,
  }))
  const { error: insertError } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .upsert(entregas, {
      onConflict: 'notificacion_id,suscripcion_id',
      ignoreDuplicates: true,
    })

  if (insertError) throw insertError

  const { error: updateError } = await supabaseAdmin
    .from('notificaciones_docente')
    .update({
      push_estado: 'pendiente',
      push_enqueued_at: ahora,
    })
    .eq('id', notificacion.id)
    .is('push_enqueued_at', null)

  if (updateError) throw updateError
  return entregas.length
}

async function prepararNotificacionesPendientes() {
  const { data: notificaciones, error } = await supabaseAdmin
    .from('notificaciones_docente')
    .select('id, docente_id, tipo, push_enqueued_at')
    .eq('push_estado', 'pendiente')
    .is('push_enqueued_at', null)
    .order('created_at', { ascending: true })
    .limit(MAX_ENTREGAS_POR_CICLO)

  if (error) throw error

  let encoladas = 0
  for (const notificacion of notificaciones || []) {
    if (await encolarNotificacion(notificacion)) encoladas++
  }
  return encoladas
}

async function cargarEntregasVencidas(ahora) {
  const { data: pendientes, error: pendientesError } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .select('id, notificacion_id, suscripcion_id, intentos')
    .eq('estado', 'pendiente')
    .lte('proximo_intento_at', ahora)
    .order('proximo_intento_at', { ascending: true })
    .limit(MAX_ENTREGAS_POR_CICLO)

  if (pendientesError) throw pendientesError

  const { data: fallidas, error: fallidasError } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .select('id, notificacion_id, suscripcion_id, intentos')
    .eq('estado', 'fallida')
    .lt('intentos', MAX_INTENTOS_PUSH)
    .lte('proximo_intento_at', ahora)
    .order('proximo_intento_at', { ascending: true })
    .limit(MAX_ENTREGAS_POR_CICLO)

  if (fallidasError) throw fallidasError

  return [...(pendientes || []), ...(fallidas || [])]
    .slice(0, MAX_ENTREGAS_POR_CICLO)
}

async function reclamarEntrega(entrega, ahora) {
  const { data, error } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .update({
      estado: 'enviando',
      intentos: entrega.intentos + 1,
      ultimo_intento_at: ahora,
      error: null,
    })
    .eq('id', entrega.id)
    .in('estado', ['pendiente', 'fallida'])
    .lte('proximo_intento_at', ahora)
    .select('id, notificacion_id, suscripcion_id, intentos')
    .maybeSingle()

  if (error) throw error
  return data
}

async function enviarEntrega(entrega) {
  const [suscripcionResult, notificacionResult] = await Promise.all([
    supabaseAdmin
      .from('push_suscripciones')
      .select('id, endpoint, p256dh, auth, expiration_time')
      .eq('id', entrega.suscripcion_id)
      .maybeSingle(),
    supabaseAdmin
      .from('notificaciones_docente')
      .select('id, tipo')
      .eq('id', entrega.notificacion_id)
      .maybeSingle(),
  ])

  if (suscripcionResult.error) throw suscripcionResult.error
  if (notificacionResult.error) throw notificacionResult.error
  if (!suscripcionResult.data || !notificacionResult.data) {
    return { expirada: true, error: 'La suscripción o notificación ya no existe.' }
  }

  const suscripcion = suscripcionResult.data
  if (
    suscripcion.expiration_time
    && new Date(suscripcion.expiration_time).getTime() <= Date.now()
  ) {
    return { expirada: true, suscripcionId: suscripcion.id, error: 'La suscripción venció.' }
  }

  const payload = crearPayloadPush(notificacionResult.data.tipo, process.env.FRONTEND_URL)
  if (!payload) {
    return { permanente: true, error: 'El tipo de notificación o FRONTEND_URL no es válido.' }
  }

  try {
    await sendNotification({
      endpoint: suscripcion.endpoint,
      keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
    }, JSON.stringify(payload), { TTL: 24 * 60 * 60, urgency: 'normal' })

    const { error } = await supabaseAdmin
      .from('notificaciones_push_envios')
      .update({ estado: 'enviada', enviada_at: new Date().toISOString(), error: null })
      .eq('id', entrega.id)
      .eq('estado', 'enviando')

    if (error) throw error
    return { enviada: true }
  } catch (error) {
    const statusCode = Number(error.statusCode)
    if (statusCode === 404 || statusCode === 410) {
      return {
        expirada: true,
        suscripcionId: suscripcion.id,
        error: 'El servicio Push indicó que la suscripción venció.',
      }
    }

    return {
      error: String(error.message || 'Error del servicio Push.').slice(0, 300),
      permanente: statusCode >= 400 && statusCode < 500 && statusCode !== 429,
    }
  }
}

async function registrarResultadoEntrega(entrega, resultado, ahora) {
  if (resultado.expirada) {
    const { error } = await supabaseAdmin
      .from('notificaciones_push_envios')
      .update({
        estado: 'expirada',
        proximo_intento_at: null,
        error: resultado.error,
      })
      .eq('id', entrega.id)
      .eq('estado', 'enviando')

    if (error) throw error

    if (resultado.suscripcionId) {
      const { error: eliminarError } = await supabaseAdmin
        .from('push_suscripciones')
        .delete()
        .eq('id', resultado.suscripcionId)
      if (eliminarError) throw eliminarError
    }
    return
  }

  if (resultado.enviada) return

  const agotados = resultado.permanente || entrega.intentos >= MAX_INTENTOS_PUSH
  const { error } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .update({
      estado: 'fallida',
      proximo_intento_at: agotados ? null : obtenerProximoReintento(entrega.intentos, ahora),
      error: resultado.error,
    })
    .eq('id', entrega.id)
    .eq('estado', 'enviando')

  if (error) throw error
}

async function limpiarSuscripcionesVencidas(ahora) {
  const { error } = await supabaseAdmin
    .from('push_suscripciones')
    .delete()
    .not('expiration_time', 'is', null)
    .lte('expiration_time', ahora)

  if (error) throw error
}

async function recuperarEnviosAtascados(ahora) {
  const corte = new Date(new Date(ahora).getTime() - ENVIO_ATASCADO_MS).toISOString()
  const { error } = await supabaseAdmin
    .from('notificaciones_push_envios')
    .update({
      estado: 'fallida',
      proximo_intento_at: ahora,
      error: 'El proceso de envío se interrumpió antes de registrar el resultado.',
    })
    .eq('estado', 'enviando')
    .lte('ultimo_intento_at', corte)

  if (error) throw error
}

export async function procesarColaPush(ahora = new Date()) {
  if (!configurarWebPush()) {
    return { configurado: false, encoladas: 0, enviadas: 0, fallidas: 0, expiradas: 0 }
  }

  const ahoraIso = ahora.toISOString()
  let encoladas = 0
  let enviadas = 0
  let fallidas = 0
  let expiradas = 0

  try {
    encoladas = await prepararNotificacionesPendientes()
    await limpiarSuscripcionesVencidas(ahoraIso)
    await recuperarEnviosAtascados(ahoraIso)

    const entregas = await cargarEntregasVencidas(ahoraIso)
    for (const candidata of entregas) {
      const entrega = await reclamarEntrega(candidata, ahoraIso)
      if (!entrega) continue

      try {
        const resultado = await enviarEntrega(entrega)
        await registrarResultadoEntrega(entrega, resultado, ahora.getTime())
        if (resultado.enviada) enviadas++
        else if (resultado.expirada) expiradas++
        else fallidas++
        await actualizarEstadoNotificacion(entrega.notificacion_id)
      } catch (error) {
        fallidas++
        console.error('❌ Error al procesar una entrega push:', error.message)
      }
    }

    return { configurado: true, encoladas, enviadas, fallidas, expiradas }
  } catch (error) {
    console.error('❌ Error al procesar la cola de notificaciones push:', error.message)
    return { configurado: true, encoladas, enviadas, fallidas: fallidas + 1, expiradas, error: error.message }
  }
}
