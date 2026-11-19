import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabaseAdmin } from '../config/supabase.js'
import { esUsuarioAdminDesdeDb, requireAdmin } from './admin.js'

const router = Router()
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const TIPOS = ['aviso', 'oferta', 'plan', 'personal']
const MAX_TITULO = 150
const MAX_CUERPO = 2000

// Leer y responder no debe bloquearse por suscripción vencida
const skipWriteCheck = (req, _res, next) => {
  req.skipSubscriptionWriteCheck = true
  next()
}

const textoValido = (valor, max) => typeof valor === 'string' && valor.trim().length > 0 && valor.trim().length <= max
const fail = (res, error, msg) => {
  console.error(`❌ ${msg}:`, error.message)
  res.status(500).json({ error: msg })
}

/* ───────────── Docente ───────────── */

// Bandeja del docente + contador para el badge rojo
router.get('/', skipWriteCheck, requireAuth, async (req, res) => {
  try {
    const esAdmin = await esUsuarioAdminDesdeDb(req.user)

    if (esAdmin) {
      const { data, error } = await supabaseAdmin
        .from('mensajes_docente_admin')
        .select('id, titulo, cuerpo, estado, leido_por_admin_at, created_at, docentes(nombre, apellido, email)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error

      const mensajes = (data || []).map((mensaje) => ({
        ...mensaje,
        tipo: 'consulta',
        leida_at: mensaje.leido_por_admin_at,
        ultima_actividad_at: mensaje.created_at,
        docente: mensaje.docentes || null,
        origen: 'docente',
      }))

      return res.json({
        mensajes,
        noLeidos: mensajes.filter((mensaje) => !mensaje.leida_at).length,
      })
    }

    const { data: enviadosPorAdmin, error: errorEnviados } = await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .select('id, leida_at, ultima_actividad_at, mensajes_admin(tipo, titulo, cuerpo, created_at)')
      .eq('docente_id', req.user.id)
      .order('ultima_actividad_at', { ascending: false })
      .limit(100)
    if (errorEnviados) throw errorEnviados

    const { data: consultas, error: errorConsultas } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id, titulo, cuerpo, estado, leido_por_docente_at, created_at, mensajes_docente_admin_respuestas(id, autor, cuerpo, created_at)')
      .eq('docente_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (errorConsultas) throw errorConsultas

    const mensajesAdmin = (enviadosPorAdmin || []).map((d) => ({
      id: d.id,
      origen: 'admin',
      leida_at: d.leida_at,
      ultima_actividad_at: d.ultima_actividad_at,
      ...d.mensajes_admin,
    }))
    const consultasDocente = (consultas || []).map((consulta) => {
      const respuestas = [...(consulta.mensajes_docente_admin_respuestas || [])]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      const { mensajes_docente_admin_respuestas, leido_por_docente_at, ...mensaje } = consulta
      return {
        ...mensaje,
        tipo: 'consulta',
        origen: 'docente',
        leida_at: leido_por_docente_at,
        ultima_actividad_at: respuestas.at(-1)?.created_at || mensaje.created_at,
        respuestas: respuestas.length,
      }
    })
    const mensajes = [...mensajesAdmin, ...consultasDocente]
      .sort((a, b) => new Date(b.ultima_actividad_at) - new Date(a.ultima_actividad_at))
      .slice(0, 100)

    res.json({ mensajes, noLeidos: mensajes.filter((m) => !m.leida_at).length })
  } catch (error) {
    fail(res, error, 'No se pudieron obtener los mensajes.')
  }
})

router.get('/no-leidos', skipWriteCheck, requireAuth, async (req, res) => {
  try {
    const esAdmin = await esUsuarioAdminDesdeDb(req.user)
    if (esAdmin) {
      const { count, error } = await supabaseAdmin
        .from('mensajes_docente_admin')
        .select('id', { count: 'exact', head: true })
        .is('leido_por_admin_at', null)
      if (error) throw error
      return res.json({ noLeidos: count || 0 })
    }

    const { count: noLeidosAdmin, error: errorAdmin } = await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .select('id', { count: 'exact', head: true })
      .eq('docente_id', req.user.id)
      .is('leida_at', null)
    if (errorAdmin) throw errorAdmin

    const { count: noLeidasConsultas, error: errorConsultas } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id', { count: 'exact', head: true })
      .eq('docente_id', req.user.id)
      .is('leido_por_docente_at', null)
    if (errorConsultas) throw errorConsultas

    res.json({ noLeidos: (noLeidosAdmin || 0) + (noLeidasConsultas || 0) })
  } catch (error) {
    fail(res, error, 'No se pudo obtener el contador.')
  }
})

async function obtenerDestinatario(id, docenteId) {
  const { data, error } = await supabaseAdmin
    .from('mensajes_admin_destinatarios')
    .select('id, docente_id, leida_at, mensajes_admin(tipo, titulo, cuerpo, created_at)')
    .eq('id', id)
    .eq('docente_id', docenteId)
    .maybeSingle()
  if (error) throw error
  return data
}

// Conversación completa; al abrirla se marca como leída
router.get('/:id([0-9a-fA-F-]{36})', skipWriteCheck, requireAuth, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  try {
    const esAdmin = await esUsuarioAdminDesdeDb(req.user)
    if (esAdmin) {
      const { data: mensaje, error: errMensaje } = await supabaseAdmin
        .from('mensajes_docente_admin')
        .select('id, docente_id, titulo, cuerpo, estado, created_at, docentes(nombre, apellido, email)')
        .eq('id', req.params.id)
        .maybeSingle()
      if (errMensaje) throw errMensaje

      if (mensaje) {
        const { data: respuestas, error: errResp } = await supabaseAdmin
          .from('mensajes_docente_admin_respuestas')
          .select('id, autor, cuerpo, created_at')
          .eq('mensaje_id', mensaje.id)
          .order('created_at', { ascending: true })
        if (errResp) throw errResp

        const { error: errUpdate } = await supabaseAdmin
          .from('mensajes_docente_admin')
          .update({ leido_por_admin_at: new Date().toISOString() })
          .eq('id', mensaje.id)
        if (errUpdate) throw errUpdate

        return res.json({
          mensaje: { ...mensaje, docente: mensaje.docentes || null, origen: 'docente' },
          respuestas: respuestas || [],
        })
      }
    }

    const { data: consulta, error: errConsulta } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id, docente_id, titulo, cuerpo, estado, leido_por_docente_at, created_at')
      .eq('id', req.params.id)
      .eq('docente_id', req.user.id)
      .maybeSingle()
    if (errConsulta) throw errConsulta

    if (consulta) {
      const { data: respuestas, error: errResp } = await supabaseAdmin
        .from('mensajes_docente_admin_respuestas')
        .select('id, autor, cuerpo, created_at')
        .eq('mensaje_id', consulta.id)
        .order('created_at', { ascending: true })
      if (errResp) throw errResp

      if (!consulta.leido_por_docente_at) {
        const { error: errUpdate } = await supabaseAdmin
          .from('mensajes_docente_admin')
          .update({ leido_por_docente_at: new Date().toISOString() })
          .eq('id', consulta.id)
          .eq('docente_id', req.user.id)
        if (errUpdate) throw errUpdate
      }

      return res.json({ mensaje: { ...consulta, tipo: 'consulta', origen: 'docente' }, respuestas: respuestas || [] })
    }

    const dest = await obtenerDestinatario(req.params.id, req.user.id)
    if (!dest) return res.status(404).json({ error: 'Mensaje no encontrado.' })

    const { data: respuestas, error } = await supabaseAdmin
      .from('mensajes_admin_respuestas')
      .select('id, autor, cuerpo, created_at')
      .eq('destinatario_id', dest.id)
      .order('created_at', { ascending: true })
    if (error) throw error

    if (!dest.leida_at) {
      await supabaseAdmin
        .from('mensajes_admin_destinatarios')
        .update({ leida_at: new Date().toISOString() })
        .eq('id', dest.id)
    }

    res.json({ mensaje: { id: dest.id, ...dest.mensajes_admin }, respuestas: respuestas || [] })
  } catch (error) {
    fail(res, error, 'No se pudo obtener el mensaje.')
  }
})

router.post('/:id/responder', skipWriteCheck, requireAuth, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  if (!textoValido(req.body?.cuerpo, MAX_CUERPO)) {
    return res.status(400).json({ error: `La respuesta es obligatoria (máx. ${MAX_CUERPO} caracteres).` })
  }
  try {
    const esAdmin = await esUsuarioAdminDesdeDb(req.user)
    if (esAdmin) {
      const { data: mensaje, error: errMensaje } = await supabaseAdmin
        .from('mensajes_docente_admin')
        .select('id')
        .eq('id', req.params.id)
        .maybeSingle()
      if (errMensaje) throw errMensaje

      if (mensaje) {
        const { data, error } = await supabaseAdmin
          .from('mensajes_docente_admin_respuestas')
          .insert({ mensaje_id: mensaje.id, autor: 'admin', cuerpo: req.body.cuerpo.trim() })
          .select('id, autor, cuerpo, created_at')
          .single()
        if (error) throw error

        const { error: errUpdate } = await supabaseAdmin
          .from('mensajes_docente_admin')
          .update({
            estado: 'respondido',
            leido_por_admin_at: new Date().toISOString(),
            leido_por_docente_at: null,
          })
          .eq('id', mensaje.id)
        if (errUpdate) throw errUpdate

        return res.status(201).json({ respuesta: data })
      }
    }

    const { data: consulta, error: errConsulta } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id')
      .eq('id', req.params.id)
      .eq('docente_id', req.user.id)
      .maybeSingle()
    if (errConsulta) throw errConsulta

    if (consulta) {
      const { data, error } = await supabaseAdmin
        .from('mensajes_docente_admin_respuestas')
        .insert({ mensaje_id: consulta.id, autor: 'docente', cuerpo: req.body.cuerpo.trim() })
        .select('id, autor, cuerpo, created_at')
        .single()
      if (error) throw error

      const { error: errUpdate } = await supabaseAdmin
        .from('mensajes_docente_admin')
        .update({
          estado: 'abierto',
          leido_por_admin_at: null,
          leido_por_docente_at: new Date().toISOString(),
        })
        .eq('id', consulta.id)
        .eq('docente_id', req.user.id)
      if (errUpdate) throw errUpdate

      return res.status(201).json({ respuesta: data })
    }

    const dest = await obtenerDestinatario(req.params.id, req.user.id)
    if (!dest) return res.status(404).json({ error: 'Mensaje no encontrado.' })

    const { data, error } = await supabaseAdmin
      .from('mensajes_admin_respuestas')
      .insert({ destinatario_id: dest.id, autor: 'docente', cuerpo: req.body.cuerpo.trim() })
      .select('id, autor, cuerpo, created_at')
      .single()
    if (error) throw error

    await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .update({ ultima_actividad_at: new Date().toISOString(), leida_at: new Date().toISOString(), admin_leyo_respuestas_at: null })
      .eq('id', dest.id)

    res.status(201).json({ respuesta: data })
  } catch (error) {
    fail(res, error, 'No se pudo enviar la respuesta.')
  }
})

/* ───────────── Docente → Admin ───────────── */

router.get('/docente-admin', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id, titulo, cuerpo, estado, leido_por_admin_at, leido_por_docente_at, created_at')
      .eq('docente_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error

    const mensajes = (data || []).map((mensaje) => ({
      ...mensaje,
      respuestas: 0,
    }))

    res.json({ mensajes })
  } catch (error) {
    fail(res, error, 'No se pudieron obtener los mensajes enviados al administrador.')
  }
})

router.get('/docente-admin/:id', requireAuth, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  try {
    const { data: mensaje, error: errMensaje } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id, docente_id, titulo, cuerpo, estado, leido_por_admin_at, leido_por_docente_at, created_at')
      .eq('id', req.params.id)
      .eq('docente_id', req.user.id)
      .maybeSingle()
    if (errMensaje) throw errMensaje
    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' })

    const { data: respuestas, error: errResp } = await supabaseAdmin
      .from('mensajes_docente_admin_respuestas')
      .select('id, autor, cuerpo, created_at')
      .eq('mensaje_id', req.params.id)
      .order('created_at', { ascending: true })
    if (errResp) throw errResp

    if (!mensaje.leido_por_docente_at) {
      const { error: errUpdate } = await supabaseAdmin
        .from('mensajes_docente_admin')
        .update({ leido_por_docente_at: new Date().toISOString() })
        .eq('id', mensaje.id)
        .eq('docente_id', req.user.id)
      if (errUpdate) throw errUpdate
    }

    res.json({ mensaje, respuestas: respuestas || [] })
  } catch (error) {
    fail(res, error, 'No se pudo obtener el mensaje con el administrador.')
  }
})

router.post('/docente-admin', requireAuth, async (req, res) => {
  const { titulo, cuerpo } = req.body || {}

  if (!textoValido(titulo, MAX_TITULO)) return res.status(400).json({ error: 'Título inválido.' })
  if (!textoValido(cuerpo, MAX_CUERPO)) return res.status(400).json({ error: 'Mensaje inválido.' })

  try {
    const { data, error } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .insert({
        docente_id: req.user.id,
        titulo: titulo.trim(),
        cuerpo: cuerpo.trim(),
        leido_por_docente_at: new Date().toISOString(),
      })
      .select('id, titulo, cuerpo, estado, created_at')
      .single()
    if (error) throw error

    res.status(201).json({ mensaje: data })
  } catch (error) {
    fail(res, error, 'No se pudo enviar el mensaje al administrador.')
  }
})

router.post('/docente-admin/:id/responder', requireAuth, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  if (!textoValido(req.body?.cuerpo, MAX_CUERPO)) {
    return res.status(400).json({ error: `La respuesta es obligatoria (máx. ${MAX_CUERPO} caracteres).` })
  }

  try {
    const { data: mensaje, error: errMensaje } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id')
      .eq('id', req.params.id)
      .eq('docente_id', req.user.id)
      .maybeSingle()
    if (errMensaje) throw errMensaje
    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' })

    const { data, error } = await supabaseAdmin
      .from('mensajes_docente_admin_respuestas')
      .insert({
        mensaje_id: mensaje.id,
        autor: 'docente',
        cuerpo: req.body.cuerpo.trim(),
      })
      .select('id, autor, cuerpo, created_at')
      .single()
    if (error) throw error

    await supabaseAdmin
      .from('mensajes_docente_admin')
      .update({
        estado: 'abierto',
        leido_por_admin_at: null,
        leido_por_docente_at: new Date().toISOString(),
      })
      .eq('id', mensaje.id)

    res.status(201).json({ respuesta: data })
  } catch (error) {
    fail(res, error, 'No se pudo responder al administrador.')
  }
})

/* ───────────── Admin ───────────── */

// Envía un mensaje: alcance 'todos', 'plan' (con plan) o 'docentes' (con ids)
router.post('/admin/enviar', requireAuth, requireAdmin, async (req, res) => {
  const { titulo, cuerpo, tipo = 'aviso', alcance = 'todos', plan, docenteIds } = req.body || {}

  if (!textoValido(titulo, MAX_TITULO)) return res.status(400).json({ error: 'Título inválido.' })
  if (!textoValido(cuerpo, MAX_CUERPO)) return res.status(400).json({ error: 'Mensaje inválido.' })
  if (!TIPOS.includes(tipo)) return res.status(400).json({ error: 'Tipo inválido.' })

  try {
    let ids = []
    if (alcance === 'todos' || alcance === 'plan') {
      let query = supabaseAdmin.from('docentes').select('id')
      if (alcance === 'plan') {
        if (!textoValido(plan, 30)) return res.status(400).json({ error: 'Indicá el plan destinatario.' })
        query = query.eq('plan', plan.trim().toLowerCase())
      }
      const { data, error } = await query
      if (error) throw error
      ids = (data || []).map((d) => d.id)
    } else if (alcance === 'docentes') {
      if (!Array.isArray(docenteIds) || !docenteIds.length || !docenteIds.every((i) => UUID_PATTERN.test(i))) {
        return res.status(400).json({ error: 'docenteIds debe ser una lista de IDs válidos.' })
      }
      ids = [...new Set(docenteIds)]
    } else {
      return res.status(400).json({ error: 'Alcance inválido.' })
    }

    if (!ids.length) return res.status(404).json({ error: 'No hay destinatarios para ese alcance.' })

    const { data: mensaje, error: errMsg } = await supabaseAdmin
      .from('mensajes_admin')
      .insert({ tipo, titulo: titulo.trim(), cuerpo: cuerpo.trim(), alcance, created_by: req.user.id })
      .select('id')
      .single()
    if (errMsg) throw errMsg

    for (let i = 0; i < ids.length; i += 500) {
      const lote = ids.slice(i, i + 500).map((docente_id) => ({ mensaje_id: mensaje.id, docente_id }))
      const { error } = await supabaseAdmin.from('mensajes_admin_destinatarios').insert(lote)
      if (error) throw error
    }

    res.status(201).json({ id: mensaje.id, destinatarios: ids.length })
  } catch (error) {
    fail(res, error, 'No se pudo enviar el mensaje.')
  }
})

// Mensajes enviados con cantidad de destinatarios
router.get('/admin/enviados', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mensajes_admin')
      .select('id, tipo, titulo, cuerpo, alcance, created_at, mensajes_admin_destinatarios(count)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error
    res.json({
      mensajes: (data || []).map(({ mensajes_admin_destinatarios, ...m }) => ({
        ...m,
        destinatarios: mensajes_admin_destinatarios?.[0]?.count ?? 0,
      })),
    })
  } catch (error) {
    fail(res, error, 'No se pudieron obtener los mensajes enviados.')
  }
})

// Conversaciones con respuestas de docentes aún no leídas por el admin
router.get('/admin/respuestas-pendientes', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .select('id, docente_id, ultima_actividad_at, docentes(nombre, apellido, email), mensajes_admin(titulo), mensajes_admin_respuestas!inner(autor)')
      .is('admin_leyo_respuestas_at', null)
      .eq('mensajes_admin_respuestas.autor', 'docente')
      .order('ultima_actividad_at', { ascending: false })
      .limit(100)
    if (error) throw error
    res.json({ conversaciones: data || [] })
  } catch (error) {
    fail(res, error, 'No se pudieron obtener las respuestas.')
  }
})

router.get('/admin/docente-admin', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id, docente_id, titulo, cuerpo, estado, created_at, docentes(nombre, apellido, email)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw error

    const mensajes = (data || []).map((mensaje) => ({
      ...mensaje,
      docente: mensaje.docentes || null,
      respuestas: 0,
    }))

    res.json({ mensajes })
  } catch (error) {
    fail(res, error, 'No se pudieron obtener los mensajes de docentes al administrador.')
  }
})

// Contador para el badge del admin: mensajes de docentes sin leer
router.get('/admin/docente-admin-no-leidos', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { count, error } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id', { count: 'exact', head: true })
      .is('leido_por_admin_at', null)
    if (error) throw error
    res.json({ noLeidos: count || 0 })
  } catch (error) {
    fail(res, error, 'No se pudo obtener el contador de mensajes de docentes.')
  }
})

router.get('/admin/docente-admin/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  try {
    const { data: mensaje, error: errMensaje } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id, docente_id, titulo, cuerpo, estado, created_at, docentes(nombre, apellido, email)')
      .eq('id', req.params.id)
      .maybeSingle()
    if (errMensaje) throw errMensaje
    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' })

    const { data: respuestas, error: errResp } = await supabaseAdmin
      .from('mensajes_docente_admin_respuestas')
      .select('id, autor, cuerpo, created_at')
      .eq('mensaje_id', req.params.id)
      .order('created_at', { ascending: true })
    if (errResp) throw errResp

    const { error: errUpdate } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .update({ leido_por_admin_at: new Date().toISOString() })
      .eq('id', req.params.id)
    if (errUpdate) throw errUpdate

    res.json({ mensaje: { ...mensaje, docente: mensaje.docentes || null }, respuestas: respuestas || [] })
  } catch (error) {
    fail(res, error, 'No se pudo obtener la conversación con el docente.')
  }
})

router.post('/admin/docente-admin/:id/responder', requireAuth, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  if (!textoValido(req.body?.cuerpo, MAX_CUERPO)) {
    return res.status(400).json({ error: `La respuesta es obligatoria (máx. ${MAX_CUERPO} caracteres).` })
  }

  try {
    const { data: mensaje, error: errMensaje } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (errMensaje) throw errMensaje
    if (!mensaje) return res.status(404).json({ error: 'Mensaje no encontrado.' })

    const { data, error } = await supabaseAdmin
      .from('mensajes_docente_admin_respuestas')
      .insert({ mensaje_id: mensaje.id, autor: 'admin', cuerpo: req.body.cuerpo.trim() })
      .select('id, autor, cuerpo, created_at')
      .single()
    if (error) throw error

    const { error: errUpdate } = await supabaseAdmin
      .from('mensajes_docente_admin')
      .update({
        estado: 'respondido',
        leido_por_admin_at: new Date().toISOString(),
        leido_por_docente_at: null,
      })
      .eq('id', mensaje.id)
    if (errUpdate) throw errUpdate

    res.status(201).json({ respuesta: data })
  } catch (error) {
    fail(res, error, 'No se pudo responder al docente.')
  }
})

router.get('/admin/conversacion/:id', requireAuth, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  try {
    const { data: respuestas, error } = await supabaseAdmin
      .from('mensajes_admin_respuestas')
      .select('id, autor, cuerpo, created_at')
      .eq('destinatario_id', req.params.id)
      .order('created_at', { ascending: true })
    if (error) throw error

    await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .update({ admin_leyo_respuestas_at: new Date().toISOString() })
      .eq('id', req.params.id)

    res.json({ respuestas: respuestas || [] })
  } catch (error) {
    fail(res, error, 'No se pudo obtener la conversación.')
  }
})

router.post('/admin/conversacion/:id/responder', requireAuth, requireAdmin, async (req, res) => {
  if (!UUID_PATTERN.test(req.params.id)) return res.status(400).json({ error: 'ID inválido.' })
  if (!textoValido(req.body?.cuerpo, MAX_CUERPO)) return res.status(400).json({ error: 'Respuesta inválida.' })
  try {
    const { data: dest, error: errDest } = await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle()
    if (errDest) throw errDest
    if (!dest) return res.status(404).json({ error: 'Conversación no encontrada.' })

    const { data, error } = await supabaseAdmin
      .from('mensajes_admin_respuestas')
      .insert({ destinatario_id: dest.id, autor: 'admin', cuerpo: req.body.cuerpo.trim() })
      .select('id, autor, cuerpo, created_at')
      .single()
    if (error) throw error

    // Vuelve a aparecer como no leído para el docente (badge rojo)
    await supabaseAdmin
      .from('mensajes_admin_destinatarios')
      .update({ ultima_actividad_at: new Date().toISOString(), leida_at: null, admin_leyo_respuestas_at: new Date().toISOString() })
      .eq('id', dest.id)

    res.status(201).json({ respuesta: data })
  } catch (error) {
    fail(res, error, 'No se pudo enviar la respuesta.')
  }
})

export default router
