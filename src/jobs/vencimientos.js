import { supabaseAdmin } from '../config/supabase.js'

// ─────────────────────────────────────────────────────────────────────────────
// CRON JOB: Vencimiento de suscripciones
//
// Lógica del ciclo de vida:
//   Vencimiento → solo lectura durante 30 días
//   Fin de gracia → plan gratuito, conservando los datos
//
// Este job corre diariamente y procesa:
//   1. Planes pagos vencidos hace 30 días o más → degradar a gratuito
//   2. Planes pagos vencidos dentro de los 30 días → mantener en solo lectura
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_EMAILS = [
  'nbarzotti6@gmail.com',
  'natalia@agendadocente.com',
  'admin@agendadocente.com',
]

const DIAS_GRACIA = 30

/**
 * Procesa los vencimientos de suscripciones.
 * Devuelve un resumen de las acciones realizadas.
 */
export async function procesarVencimientos() {
  const ahora = new Date()

  console.log(`\n⏰ [Cron Vencimientos] Iniciando proceso: ${ahora.toISOString()}`)

  try {
    // El modo de solo lectura se determina desde trial_ends_at en requireWritable.
    const { data: docentes, error } = await supabaseAdmin
      .from('docentes')
      .select('id, email, plan, subscription_plan, trial_ends_at')
      .not('trial_ends_at', 'is', null)

    if (error) {
      console.error('❌ [Cron Vencimientos] Error al consultar docentes:', error.message)
      return { error: error.message }
    }

    if (!docentes || docentes.length === 0) {
      console.log('✅ [Cron Vencimientos] No hay docentes con suscripciones activas para procesar.')
      return { procesados: 0, soloLectura: 0, degradados: 0 }
    }

    let countSoloLectura = 0
    let countDegradados = 0
    let countOk = 0

    for (const docente of docentes) {
      // Nunca tocar a los admins/fundadora ni cuentas que no tengan plan pago.
      if (ADMIN_EMAILS.includes(docente.email?.toLowerCase())) continue
      const tienePlanPago =
        ['pro', 'premium'].includes(docente.plan) ||
        ['pro', 'premium'].includes(docente.subscription_plan)
      if (!tienePlanPago) continue

      const vencimiento = new Date(docente.trial_ends_at)
      if (Number.isNaN(vencimiento.getTime())) {
        console.error(`❌ Fecha de vencimiento inválida para ${docente.email}`)
        continue
      }

      if (vencimiento > ahora) {
        countOk++
        continue
      }

      const diasDesdeVencimiento = Math.floor((ahora - vencimiento) / (1000 * 60 * 60 * 24))

      if (diasDesdeVencimiento >= DIAS_GRACIA) {
        // ─── DEGRADACIÓN DEFINITIVA ───
        // Finalizó la gracia; los datos se conservan.
        const { error: errUpdate } = await supabaseAdmin
          .from('docentes')
          .update({
            plan: 'gratuito',
            is_premium: false,
            subscription_plan: 'free',
            trial_ends_at: null,
            updated_at: ahora.toISOString(),
          })
          .eq('id', docente.id)

        if (errUpdate) {
          console.error(`❌ Error al degradar docente ${docente.email}:`, errUpdate.message)
        } else {
          console.log(`📦 [Degradado definitivo] ${docente.email} → plan gratuito (venció hace ${diasDesdeVencimiento} días)`)
          countDegradados++
        }
      } else {
        console.log(`🔒 [Solo Lectura] ${docente.email} → gracia de 30 días (venció hace ${diasDesdeVencimiento} días)`)
        countSoloLectura++
      }
    }

    const resumen = {
      ejecutadoEn: ahora.toISOString(),
      totalRevisados: docentes.length,
      vigentes: countOk,
      pasadosASoloLectura: countSoloLectura,
      degradadosAGratuito: countDegradados,
    }

    console.log('✅ [Cron Vencimientos] Resumen:', resumen)
    return resumen

  } catch (err) {
    console.error('❌ [Cron Vencimientos] Error inesperado:', err.message)
    return { error: err.message }
  }
}

/**
 * Inicia el cron job de vencimientos.
 * Corre inmediatamente al arrancar el server, y luego cada 24 horas.
 */
export function iniciarCronVencimientos() {
  const INTERVALO_MS = 24 * 60 * 60 * 1000 // 24 horas

  console.log('🕐 [Cron Vencimientos] Job registrado — se ejecuta al inicio y cada 24hs.')

  // Primera ejecución inmediata al arrancar
  void procesarVencimientos()

  // Ejecución periódica cada 24hs
  const intervalo = setInterval(() => {
    void procesarVencimientos()
  }, INTERVALO_MS)
  intervalo.unref?.()
}
