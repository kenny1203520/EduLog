import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config/config.js'
import { createSupabaseClients } from './infra/supabase.js'
import { attachRealtimeProxy } from './realtime/realtime.js'
import { installProcessGuards } from './processGuards.js'

installProcessGuards()
const config = loadConfig()
const clients = createSupabaseClients(config)
const server = createServer(createApp())
attachRealtimeProxy(server, clients.adminClient, config)
server.listen(config.API_PORT, '0.0.0.0', () => console.log(JSON.stringify({ event: 'api_started', port: config.API_PORT })))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
process.on('SIGINT', () => server.close(() => process.exit(0)))