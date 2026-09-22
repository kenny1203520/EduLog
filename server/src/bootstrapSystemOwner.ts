import { z } from 'zod'
import { loadConfig } from './config.js'
import { createSupabaseClients } from './supabase.js'

const userId = z.string().uuid().parse(process.env.SYSTEM_OWNER_USER_ID)
const clients = createSupabaseClients(loadConfig())
const { data, error } = await clients.adminClient.rpc('bootstrap_system_owner', { p_user_id: userId })
if (error) throw new Error(`System owner bootstrap failed (${error.code ?? 'UNKNOWN'})`)
process.stdout.write(`System owner bootstrap completed: ${String(data)}\n`)
