import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { env } from '../_shared/env.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = env.supabaseUrl ?? ''
  const serviceRoleKey = env.serviceRoleKey ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing Authorization token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  })

  // Try to resolve user from access token
  let userId: string | null = null
  try {
    const userRes = await client.auth.getUser(token)
    if (userRes.error || !userRes.data?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    userId = userRes.data.user.id
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to validate token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const [prefRes, visRes] = await Promise.all([
      client.from('user_preferences').select('*').eq('user_id', userId).maybeSingle(),
      client.from('user_entity_visibility_preferences').select('entity_id, entity_type').eq('user_id', userId).eq('is_hidden', true)
    ])

    if (prefRes.error) throw prefRes.error
    if (visRes.error) throw visRes.error

    const preferences = prefRes.data || null
    const visibilityRows = visRes.data || []
    const visibility: Record<string, string[]> = {
      classroom: [],
      class_session: []
    }
    for (const r of visibilityRows as any[]) {
      const t = r.entity_type || 'classroom'
      if (!visibility[t]) visibility[t] = []
      visibility[t].push(r.entity_id)
    }

    return new Response(JSON.stringify({ preferences, visibility }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
