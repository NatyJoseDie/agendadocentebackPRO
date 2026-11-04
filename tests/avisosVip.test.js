import test from 'node:test'
import assert from 'node:assert/strict'
import { crearAvisosVip, esDocenteVipBeta } from '../src/utils/avisosVip.js'

const DAY_MS = 24 * 60 * 60 * 1000
const createdAt = new Date('2026-01-01T12:00:00.000Z')
const trialEndsAt = new Date(createdAt.getTime() + 120 * DAY_MS)
const docente = {
  id: '01234567-89ab-cdef-0123-456789abcdef',
  nombre: 'Natalia',
  created_at: createdAt.toISOString(),
  trial_ends_at: trialEndsAt.toISOString(),
  plan: 'premium',
  subscription_plan: 'premium',
  is_vip_beta: true,
}

test('identifies a VIP beta account without relying only on its current plan', () => {
  assert.equal(esDocenteVipBeta(docente), true)
  assert.equal(esDocenteVipBeta({ ...docente, is_vip_beta: false, trial_ends_at: null }), false)
  assert.equal(
    esDocenteVipBeta({
      ...docente,
      is_vip_beta: false,
      trial_ends_at: null,
      plan: 'gratuito',
      subscription_plan: 'free',
    }),
    false,
  )
})

test('creates the trial-ended notice on day 120 and does not send it early', () => {
  assert.deepEqual(crearAvisosVip(docente, new Date(trialEndsAt.getTime() - 1)), [])

  const notices = crearAvisosVip(docente, trialEndsAt)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].tipo, 'vip_trial_ended')
  assert.equal(notices[0].titulo, 'Tu período VIP terminó')
  assert.match(notices[0].event_key, /vip_trial_ended$/)
})

test('creates only the most relevant notice when a daily job catches up late', () => {
  const day140 = new Date(trialEndsAt.getTime() + 20 * DAY_MS)
  const day150 = new Date(trialEndsAt.getTime() + 30 * DAY_MS)

  assert.equal(crearAvisosVip(docente, day140)[0].tipo, 'vip_grace_ending')
  assert.equal(
    crearAvisosVip({ ...docente, trial_ends_at: null }, day150)[0].tipo,
    'vip_grace_ended',
  )
  assert.equal(crearAvisosVip(docente, new Date(day150.getTime() + DAY_MS)).length, 1)
})

test('does not classify a regular annual subscription as VIP beta', () => {
  const annualPlan = {
    ...docente,
    is_vip_beta: false,
    trial_ends_at: new Date(createdAt.getTime() + 365 * DAY_MS).toISOString(),
  }

  assert.equal(esDocenteVipBeta(annualPlan), false)
  assert.deepEqual(crearAvisosVip(annualPlan, new Date()), [])
})
