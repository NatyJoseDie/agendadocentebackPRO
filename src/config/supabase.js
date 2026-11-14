import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env

const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && SUPABASE_ANON_KEY)

const createMissingSupabaseClient = () => ({
  from() {
    throw new Error('Supabase no está configurado. Faltan las variables de entorno SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY.')
  },
})

// Cliente admin (service_role) — bypassa RLS, solo para el backend
export const supabaseAdmin = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : createMissingSupabaseClient()

// Crea un cliente autenticado con el JWT del usuario — respeta RLS
export const supabaseForUser = (token) => {
  if (!hasSupabaseConfig) {
    throw new Error('Supabase no está configurado. Faltan las variables de entorno SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_ANON_KEY.')
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}
