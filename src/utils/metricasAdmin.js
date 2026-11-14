const DIA_MS = 24 * 60 * 60 * 1000

export function estadoDocenteAdmin(docente, esAdmin, ahora = new Date()) {
  const vencimiento = docente.trial_ends_at ? new Date(docente.trial_ends_at) : null
  if (vencimiento && Number.isNaN(vencimiento.getTime())) {
    throw new Error(`Fecha de vencimiento inválida para el docente ${docente.id}`)
  }

  const diasRestantes = vencimiento
    ? Math.ceil((vencimiento.getTime() - ahora.getTime()) / DIA_MS)
    : null

  let estado = 'free'
  if (esAdmin) estado = 'admin'
  else if (vencimiento && vencimiento <= ahora) estado = 'vencido'
  else if (docente.is_vip_beta) estado = 'vip_beta'
  else if (docente.plan === 'premium' || docente.subscription_plan === 'premium') estado = 'premium'
  else if (docente.plan === 'pro' || docente.subscription_plan === 'pro') estado = 'pro'
  else if (docente.plan === 'basico' || docente.subscription_plan === 'basico') estado = 'basico'

  return { estado, diasRestantes }
}
