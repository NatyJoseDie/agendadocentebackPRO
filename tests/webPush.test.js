import test from 'node:test'
import assert from 'node:assert/strict'
import {
  crearPayloadPush,
  obtenerConfiguracionVapid,
  obtenerProximoReintento,
  validarEndpointPush,
  validarPushSubscription,
} from '../src/utils/webPush.js'

const publicKey = Buffer.alloc(65, 1).toString('base64url')
const privateKey = Buffer.alloc(32, 2).toString('base64url')
const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/subscription-token',
  expirationTime: null,
  keys: {
    p256dh: publicKey,
    auth: Buffer.alloc(16, 3).toString('base64url'),
  },
}

test('accepts a valid HTTPS subscription from a supported push provider', () => {
  assert.equal(validarPushSubscription(subscription), null)
})

test('rejects non-HTTPS, unsupported, or credentialed endpoints', () => {
  assert.notEqual(validarEndpointPush('http://fcm.googleapis.com/push/token'), null)
  assert.notEqual(validarEndpointPush('https://localhost/push/token'), null)
  assert.notEqual(validarEndpointPush('https://user:pass@fcm.googleapis.com/token'), null)
})

test('rejects invalid key material and expired subscriptions', () => {
  assert.match(
    validarPushSubscription({ ...subscription, keys: { p256dh: 'invalid', auth: 'invalid' } }),
    /p256dh/,
  )
  assert.match(
    validarPushSubscription({ ...subscription, expirationTime: Date.now() - 1 }),
    /venció/,
  )
})

test('requires a valid complete VAPID configuration', () => {
  assert.equal(obtenerConfiguracionVapid({}), null)
  assert.deepEqual(
    obtenerConfiguracionVapid({
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: 'mailto:soporte@example.com',
    }),
    {
      publicKey,
      privateKey,
      subject: 'mailto:soporte@example.com',
    },
  )
  assert.equal(
    obtenerConfiguracionVapid({
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: 'http://example.com',
    }),
    null,
  )
})

test('push payloads are generic and link only to the frontend notification center', () => {
  const payload = crearPayloadPush(
    'vip_trial_ended',
    'https://agenda.example.com/base/path',
  )

  assert.equal(payload.data.url, 'https://agenda.example.com/?notificaciones=1')
  assert.equal(JSON.stringify(payload).includes('Natalia'), false)
  assert.equal(crearPayloadPush('unknown', 'https://agenda.example.com'), null)
})

test('retries use increasing delays and return ISO timestamps', () => {
  const now = Date.parse('2026-11-07T17:00:00.000Z')

  assert.equal(
    obtenerProximoReintento(1, now),
    new Date(now + 60_000).toISOString(),
  )
  assert.equal(
    obtenerProximoReintento(3, now),
    new Date(now + 30 * 60_000).toISOString(),
  )
})
