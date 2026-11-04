import { createHmac } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { verifyMercadoPagoSignature } from '../src/utils/mercadopagoWebhook.js'

const secret = 'test-webhook-secret'
const requestId = 'request-123'
const dataId = '987654321'
const timestamp = '1730745000'
const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
const signature = createHmac('sha256', secret).update(manifest).digest('hex')

test('accepts a valid Mercado Pago webhook signature', () => {
  assert.equal(
    verifyMercadoPagoSignature({
      secret,
      signature: `ts=${timestamp},v1=${signature}`,
      requestId,
      dataId,
    }),
    true,
  )
})

test('rejects a signature when the payment ID has been changed', () => {
  assert.equal(
    verifyMercadoPagoSignature({
      secret,
      signature: `ts=${timestamp},v1=${signature}`,
      requestId,
      dataId: '987654322',
    }),
    false,
  )
})

test('rejects malformed, incomplete, or incorrectly signed notifications', () => {
  const validArguments = {
    secret,
    signature: `ts=${timestamp},v1=${signature}`,
    requestId,
    dataId,
  }

  assert.equal(verifyMercadoPagoSignature({ ...validArguments, secret: '' }), false)
  assert.equal(verifyMercadoPagoSignature({ ...validArguments, requestId: '' }), false)
  assert.equal(verifyMercadoPagoSignature({ ...validArguments, signature: 'invalid' }), false)
  assert.equal(
    verifyMercadoPagoSignature({ ...validArguments, signature: `ts=${timestamp},v1=${'0'.repeat(64)}` }),
    false,
  )
})
