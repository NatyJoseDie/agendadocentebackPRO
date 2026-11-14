import test from 'node:test'
import assert from 'node:assert/strict'

const ahora = new Date('2026-11-13T12:00:00Z')

async function loadModules() {
  process.env.SUPABASE_URL ??= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'
  process.env.SUPABASE_ANON_KEY ??= 'anon-key'

  const [{ supabaseAdmin }, { requireWritable }, { estadoDocenteAdmin }] = await Promise.all([
    import('../src/config/supabase.js'),
    import('../src/middleware/requireWritable.js'),
    import('../src/utils/metricasAdmin.js'),
  ])

  return { supabaseAdmin, requireWritable, estadoDocenteAdmin }
}

test('no confunde una suscripción larga con VIP', async () => {
  const { estadoDocenteAdmin } = await loadModules()
  const docente = { plan: 'pro', is_vip_beta: false, trial_ends_at: '2027-12-31T23:59:59Z' }
  assert.equal(estadoDocenteAdmin(docente, false, ahora).estado, 'pro')
  assert.equal(estadoDocenteAdmin({ ...docente, is_vip_beta: true }, false, ahora).estado, 'vip_beta')
})

test('distingue Básico y determina el vencimiento por hora exacta', async () => {
  const { estadoDocenteAdmin } = await loadModules()
  const docente = { plan: 'basico', trial_ends_at: '2026-11-13T12:00:01Z' }
  assert.equal(estadoDocenteAdmin(docente, false, ahora).estado, 'basico')
  assert.equal(estadoDocenteAdmin({ ...docente, trial_ends_at: ahora.toISOString() }, false, ahora).estado, 'vencido')
  assert.equal(estadoDocenteAdmin(docente, true, ahora).estado, 'admin')
})

test('Básico vencido debe entrar en modo de solo lectura durante la gracia', async () => {
  const { supabaseAdmin, requireWritable } = await loadModules()
  const originalFrom = supabaseAdmin.from
  supabaseAdmin.from = () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            id: 'doc-1',
            plan: 'basico',
            subscription_plan: 'basico',
            trial_ends_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
          },
          error: null,
        }),
      }),
    }),
  })

  try {
    const req = { user: { id: 'doc-1' } }
    const res = {
      statusCode: null,
      payload: null,
      status(code) {
        this.statusCode = code
        return this
      },
      json(payload) {
        this.payload = payload
        return payload
      },
    }

    let nextCalled = false
    await requireWritable(req, res, () => {
      nextCalled = true
    })

    assert.equal(nextCalled, false)
    assert.equal(res.statusCode, 423)
    assert.equal(res.payload.code, 'READ_ONLY_GRACE_PERIOD')
  } finally {
    supabaseAdmin.from = originalFrom
  }
})

test('no presenta como válida una fecha de vencimiento inválida', async () => {
  const { estadoDocenteAdmin } = await loadModules()
  assert.throws(() => estadoDocenteAdmin({ id: 'test', trial_ends_at: 'inválida' }, false, ahora))
})
