import { supabaseAdmin } from '../config/supabase.js'
import { crearAvisosVip, esDocenteVipBeta } from '../utils/avisosVip.js'

const MAX_INTENTOS_EMAIL = 5
const REINTENTO_EN_CURSO_MS = 15 * 60 * 1000
const URL_RESEND = 'https://api.resend.com/emails'

async function enviarEmailResend({ email, asunto, mensaje }) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from || !email) return false

  const response = await fetch(URL_RESEND, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: asunto,
      text: `${mensaje}\n\n${process.env.FRONTEND_URL || ''}`,
    }),
  })

  if (!response.ok) throw new Error(`Resend respondió con HTTP ${response.status}.`)
  return true
}

async function guardarAviso(docente, aviso, ahora) {
  const { data: nuevoAviso, error: upsertError } = await supabaseAdmin
    .from('notificaciones_docente')
    .upsert({
      docente_id: docente.id,
      event_key: aviso.event_key,
      tipo: aviso.tipo,
      titulo: aviso.titulo,
      mensaje: aviso.mensaje,
      programada_para: aviso.programada_para,
    }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('id, email_estado, email_intentos, email_ultimo_intento_at')
    .maybeSingle()

  if (upsertError) throw upsertError

  let notificacion = nuevoAviso
  if (!notificacion) {
    const { data, error } = await supabaseAdmin
      .from('notificaciones_docente')
      .select('id, email_estado, email_intentos, email_ultimo_intento_at')
      .eq('event_key', aviso.event_key)
      .single()

    if (error) throw error
    notificacion = data
  }

  if (notificacion.email_estado === 'enviada') return { creada: Boolean(nuevoAviso), emailEnviado: false }
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL || !docente.email) {
    console.warn(`Aviso VIP ${aviso.tipo} guardado; email pendiente de configurar.`)
    return { creada: Boolean(nuevoAviso), emailEnviado: false }
  }

  const intentos = notificacion.email_intentos || 0
  if (intentos >= MAX_INTENTOS_EMAIL) {
    console.error(`Aviso VIP ${aviso.tipo}: se alcanzó el máximo de reintentos de email.`)
    return { creada: Boolean(nuevoAviso), emailEnviado: false }
  }

  const estadoActual = notificacion.email_estado
  const ultimoIntento = notificacion.email_ultimo_intento_at
    ? new Date(notificacion.email_ultimo_intento_at)
    : null
  const intentoEnCursoVencido =
    estadoActual === 'enviando' &&
    ultimoIntento &&
    ahora.getTime() - ultimoIntento.getTime() >= REINTENTO_EN_CURSO_MS

  if (!['pendiente', 'fallida'].includes(estadoActual) && !intentoEnCursoVencido) {
    return { creada: Boolean(nuevoAviso), emailEnviado: false }
  }

  let claim = supabaseAdmin
    .from('notificaciones_docente')
    .update({
      email_estado: 'enviando',
      email_intentos: intentos + 1,
      email_ultimo_intento_at: ahora.toISOString(),
      email_error: null,
    })
    .eq('id', notificacion.id)

  if (intentoEnCursoVencido) {
    claim = claim.eq('email_estado', 'enviando').lte(
      'email_ultimo_intento_at',
      new Date(ahora.getTime() - REINTENTO_EN_CURSO_MS).toISOString(),
    )
  } else {
    claim = claim.eq('email_estado', estadoActual)
  }

  const { data: reclamada, error: reclamoError } = await claim.select('id').maybeSingle()
  if (reclamoError) throw reclamoError
  if (!reclamada) return { creada: Boolean(nuevoAviso), emailEnviado: false }

  try {
    const enviado = await enviarEmailResend({
      email: docente.email,
      asunto: aviso.asunto,
      mensaje: aviso.mensaje,
    })
    if (!enviado) throw new Error('Falta configurar el destinatario o el remitente de Resend.')

    const { error } = await supabaseAdmin
      .from('notificaciones_docente')
      .update({
        email_estado: 'enviada',
        email_enviada_at: new Date().toISOString(),
        email_error: null,
      })
      .eq('id', notificacion.id)
      .eq('email_estado', 'enviando')

    if (error) throw error
    return { creada: Boolean(nuevoAviso), emailEnviado: true }
  } catch (error) {
    const mensajeError = error.message.slice(0, 300)
    const { error: updateError } = await supabaseAdmin
      .from('notificaciones_docente')
      .update({ email_estado: 'fallida', email_error: mensajeError })
      .eq('id', notificacion.id)
      .eq('email_estado', 'enviando')

    if (updateError) throw updateError
    console.error(`❌ No se pudo enviar el aviso VIP ${aviso.tipo}:`, mensajeError)
    throw error
  }
}

export async function procesarAvisosVip(docentes, ahora = new Date()) {
  let creadas = 0
  let emailsEnviados = 0
  let errores = 0

  for (const docente of docentes) {
    try {
      if (!esDocenteVipBeta(docente)) continue

      if (docente.is_vip_beta !== true) {
        const { error } = await supabaseAdmin
          .from('docentes')
          .update({ is_vip_beta: true })
          .eq('id', docente.id)

        if (error) throw error
      }

      for (const aviso of crearAvisosVip({ ...docente, is_vip_beta: true }, ahora)) {
        const resultado = await guardarAviso(docente, aviso, ahora)
        if (resultado.creada) creadas++
        if (resultado.emailEnviado) emailsEnviados++
      }
    } catch (error) {
      errores++
      console.error(`❌ Error al procesar avisos VIP para ${docente.id}:`, error.message)
    }
  }

  return { creadas, emailsEnviados, errores }
}
