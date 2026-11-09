import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config/config.js'
import { createSupabaseClients } from './infra/supabase.js'
import { attachRealtimeProxy } from './realtime/realtime.js'
import { installProcessGuards } from './processGuards.js'
import { STALE_RUNNING_MS } from './ai/report/generationRegistry.js'
import { SupabaseReportAssistRepository } from './ai/report/supabaseReportAssistRepository.js'

installProcessGuards()
const config = loadConfig()
const clients = createSupabaseClients(config)
const server = createServer(createApp(config, clients))
attachRealtimeProxy(server, clients.adminClient, config)
// AI generations that were running when the API last stopped can never finish.
new SupabaseReportAssistRepository(clients.adminClient, clients.adminClient)
  .failStaleRunning(new Date(Date.now() - STALE_RUNNING_MS))
  .then((count) => { if (count > 0) console.log(JSON.stringify({ event: 'ai_generations_interrupted', count })) })
  .catch((error: unknown) => console.error(JSON.stringify({ event: 'ai_generations_interrupted_failed', message: error instanceof Error ? error.message : String(error) })))
server.listen(config.API_PORT, '0.0.0.0', () => console.log(JSON.stringify({ event: 'api_started', port: config.API_PORT })))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))