const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]

const VIP_PUSH_TYPES = new Set([
  'vip_trial_ended',
  'vip_grace_ending',
  'vip_grace_ended',
])

function decodificarBase64Url(value) {
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    return Buffer.alloc(0)
  }
}

export function validarPushSubscription(subscription, ahora = Date.now()) {
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    return 'El cuerpo debe ser una suscripción Push válida.'
  }

  const errorEndpoint = validarEndpointPush(subscription.endpoint)
  if (errorEndpoint) return errorEndpoint

  const keys = subscription.keys
  if (!keys || typeof keys !== 'object') {
    return 'Faltan las claves de la suscripción.'
  }

  if (
    typeof keys.p256dh !== 'string'
    || !/^[\da-zA-Z_-]+$/.test(keys.p256dh)
    || decodificarBase64Url(keys.p256dh).length !== 65
  ) {
    return 'La clave p256dh no es válida.'
  }

  if (
    typeof keys.auth !== 'string'
    || !/^[\da-zA-Z_-]+$/.test(keys.auth)
    || decodificarBase64Url(keys.auth).length !== 16
  ) {
    return 'La clave auth no es válida.'
  }

  if (subscription.expirationTime !== null && subscription.expirationTime !== undefined) {
    if (
      typeof subscription.expirationTime !== 'number'
      || !Number.isFinite(subscription.expirationTime)
      || !Number.isFinite(new Date(subscription.expirationTime).getTime())
      || subscription.expirationTime <= ahora
    ) {
      return 'La suscripción Push ya venció o tiene una fecha inválida.'
    }
  }

  return null
}

export function validarEndpointPush(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2048) {
    return 'El endpoint de la suscripción no es válido.'
  }

  let endpoint
  try {
    endpoint = new URL(value)
  } catch {
    return 'El endpoint de la suscripción no es válido.'
  }

  const hostPermitido = PUSH_SERVICE_HOSTS.includes(endpoint.hostname)
    || endpoint.hostname.endsWith('.notify.windows.com')
    || endpoint.hostname.endsWith('.push.services.mozilla.com')
    || endpoint.hostname.endsWith('.push.apple.com')

  if (
    Buffer.byteLength(endpoint.toString(), 'utf8') > 2048
    || endpoint.protocol !== 'https:'
    || endpoint.username
    || endpoint.password
    || endpoint.hash
    || !hostPermitido
  ) {
    return 'El endpoint debe pertenecer a un servicio Push compatible y usar HTTPS.'
  }

  return null
}

export function obtenerConfiguracionVapid(environment = process.env) {
  const publicKey = environment.VAPID_PUBLIC_KEY
  const privateKey = environment.VAPID_PRIVATE_KEY
  const subject = environment.VAPID_SUBJECT

  if (!publicKey || !privateKey || !subject) return null

  const urlSubject = subject.startsWith('mailto:')
    ? null
    : (() => {
      try {
        return new URL(subject)
      } catch {
        return false
      }
    })()

  if (
    !/^[\da-zA-Z_-]+$/.test(publicKey)
    || decodificarBase64Url(publicKey).length !== 65
    || !/^[\da-zA-Z_-]+$/.test(privateKey)
    || decodificarBase64Url(privateKey).length !== 32
    || (!subject.startsWith('mailto:') && (!urlSubject || urlSubject.protocol !== 'https:'))
    || (subject.startsWith('mailto:') && !/^mailto:[^@\s]+@[^@\s]+$/.test(subject))
  ) {
    return null
  }

  return { publicKey, privateKey, subject }
}

export function crearPayloadPush(tipo, frontendUrl) {
  if (!VIP_PUSH_TYPES.has(tipo)) return null

  let url
  try {
    url = new URL('/?notificaciones=1', frontendUrl).toString()
  } catch {
    return null
  }

  return {
    title: 'Tenés una novedad en Agenda Docente',
    body: 'Abrí Agenda Docente para consultar la notificación.',
    data: { url },
  }
}

export function obtenerProximoReintento(intentos, ahora = Date.now()) {
  const demorasMs = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000]
  const demora = demorasMs[Math.min(Math.max(intentos - 1, 0), demorasMs.length - 1)]
  return new Date(ahora + demora).toISOString()
}
