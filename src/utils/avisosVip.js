const DIA_MS = 24 * 60 * 60 * 1000

const AVISOS_VIP = [
  {
    tipo: 'vip_trial_ended',
    diasDesdeVencimiento: 0,
    asunto: 'Finalizó tu período VIP',
    titulo: 'Tu período VIP terminó',
    mensaje: 'Comenzó tu período de 30 días de solo lectura. Tus datos siguen guardados; podés renovar tu plan desde la agenda.',
  },
  {
    tipo: 'vip_grace_ending',
    diasDesdeVencimiento: 20,
    asunto: 'Tu período de solo lectura termina en 10 días',
    titulo: 'Te quedan 10 días de solo lectura',
    mensaje: 'Tu período de gracia termina en 10 días. Renovando tu plan vas a conservar el acceso de escritura.',
  },
  {
    tipo: 'vip_grace_ended',
    diasDesdeVencimiento: 30,
    asunto: 'Finalizó tu período de solo lectura',
    titulo: 'Tu cuenta pasó al plan gratuito',
    mensaje: 'Terminó el período de solo lectura. Tu agenda conserva los datos y quedó en el plan gratuito.',
  },
]

export function esDocenteVipBeta(docente) {
  if (docente.is_vip_beta === true) return true

  const tienePlanPago =
    ['pro', 'premium'].includes(docente.plan) ||
    ['pro', 'premium'].includes(docente.subscription_plan)
  if (!tienePlanPago || !docente.created_at || !docente.trial_ends_at) return false

  const creado = new Date(docente.created_at)
  const vencimiento = new Date(docente.trial_ends_at)
  if (Number.isNaN(creado.getTime()) || Number.isNaN(vencimiento.getTime())) return false

  const duracionDias = (vencimiento.getTime() - creado.getTime()) / DIA_MS
  return duracionDias >= 119 && duracionDias <= 121
}

function obtenerVencimientoVip(docente) {
  if (docente.trial_ends_at) {
    const fecha = new Date(docente.trial_ends_at)
    if (!Number.isNaN(fecha.getTime())) return fecha
  }

  if (!docente.created_at) return null
  const creado = new Date(docente.created_at)
  if (Number.isNaN(creado.getTime())) return null
  return new Date(creado.getTime() + 120 * DIA_MS)
}

export function crearAvisosVip(docente, ahora = new Date()) {
  if (!esDocenteVipBeta(docente)) return []

  const vencimiento = obtenerVencimientoVip(docente)
  if (!vencimiento || Number.isNaN(ahora.getTime())) return []

  const aviso = AVISOS_VIP
    .filter((opcion) => ahora.getTime() - vencimiento.getTime() >= opcion.diasDesdeVencimiento * DIA_MS)
    .at(-1)

  if (!aviso) return []

  const programadaPara = new Date(
    vencimiento.getTime() + aviso.diasDesdeVencimiento * DIA_MS,
  )

  return [{
    ...aviso,
    mensaje: `${docente.nombre?.trim() || 'Hola'}, ${aviso.mensaje}`,
    programada_para: programadaPara.toISOString(),
    event_key: `vip:${docente.id}:${vencimiento.toISOString()}:${aviso.tipo}`,
  }]
}
