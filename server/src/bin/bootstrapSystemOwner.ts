import { z } from 'zod'
import { loadConfig } from '../config/config.js'
import { createSupabaseClients } from '../infra/supabase.js'

const parsedUserId = z.uuid().safeParse(process.env.SYSTEM_OWNER_USER_ID)
if (!parsedUserId.success) throw new Error('SYSTEM_OWNER_USER_ID must be set to the auth user uuid of the system owner')
const userId = parsedUserId.data
const clients = createSupabaseClients(loadConfig())
const { data, error } = await clients.adminClient.rpc('bootstrap_system_owner', { p_user_id: userId })
if (error) throw new Error(`System owner bootstrap failed (${error.code ?? 'UNKNOWN'})`)
process.stdout.write(`System owner bootstrap completed: ${String(data)}\n`)
