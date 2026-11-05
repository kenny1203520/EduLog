import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { env } from '../_shared/env.ts'

type SearchPayload = {
  query?: string
}

type SearchResult = {
  id: string
  email: string
  created_at?: string
  last_sign_in_at?: string | null
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = env.supabaseUrl ?? ''
  const serviceRoleKey = env.serviceRoleKey ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: SearchPayload = {}

  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  const query = (payload.query ?? '').trim().toLowerCase()
  const onlyUnlinked = Boolean((payload as any).only_unlinked || (payload as any).onlyUnlinked)

  if (!query) {
    return new Response(JSON.stringify({ users: [] }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })

  const users: SearchResult[] = []
  const maxPages = 20
  const pageSize = 100

  for (let page = 1; page <= maxPages && users.length < 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: pageSize })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const pageUsers = data?.users ?? []
    if (pageUsers.length === 0) break

    for (const user of pageUsers) {
      const email = user.email?.trim()
      if (!email) continue
      if (email.toLowerCase().includes(query)) {
        users.push({
          id: user.id,
          email,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
        })
      }
    }

    if (pageUsers.length < pageSize) break
  }

  // If requested, filter out users that are already linked in the teachers table
  if (onlyUnlinked) {
    try {
      const { data: teacherRows, error: teacherErr } = await client
        .from('teachers')
        .select('user_id')

      if (teacherErr) {
        return new Response(JSON.stringify({ error: teacherErr.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const linkedIds = new Set<string>((teacherRows ?? []).map((r: any) => r.user_id).filter(Boolean))
      const filtered = users.filter((u) => !linkedIds.has(u.id))
      return new Response(JSON.stringify({ users: filtered.slice(0, 20) }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  return new Response(JSON.stringify({ users: users.slice(0, 20) }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})