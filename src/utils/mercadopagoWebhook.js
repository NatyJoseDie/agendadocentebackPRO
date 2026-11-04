import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyMercadoPagoSignature({ secret, signature, requestId, dataId }) {
  if (!secret || !signature || !requestId || !dataId) return false

  const fields = Object.fromEntries(
    signature.split(',').map((part) => {
      const separator = part.indexOf('=')
      return separator < 0
        ? ['', '']
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()]
    }),
  )

  if (!/^\d+$/.test(fields.ts || '') || !/^[\da-f]{64}$/i.test(fields.v1 || '')) {
    return false
  }

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${fields.ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest()
  const received = Buffer.from(fields.v1, 'hex')

  return received.length === expected.length && timingSafeEqual(received, expected)
}
