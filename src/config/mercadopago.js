import { MercadoPagoConfig, Preference, Payment } from 'mercadopago'

const accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN || ''

export const mpClient = new MercadoPagoConfig({
  accessToken: accessToken
})

export const mpPreference = new Preference(mpClient)
export const mpPayment = new Payment(mpClient)
