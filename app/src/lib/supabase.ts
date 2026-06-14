import { createClient } from '@supabase/supabase-js'
import { getSupabaseRuntimeConfig } from '@/lib/runtimeConfig'

const { supabaseUrl, supabaseAnonKey } = getSupabaseRuntimeConfig()

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase URL or Anon Key. Please check your runtime environment variables.')
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')
