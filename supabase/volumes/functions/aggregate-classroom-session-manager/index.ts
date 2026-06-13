import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const page = Number(url.searchParams.get('page') || '1')
  const perPage = Number(url.searchParams.get('perPage') || '100')
  const search = url.searchParams.get('search') || ''
  const visibilityMode = url.searchParams.get('visibilityMode') || 'all'
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

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

  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  try {
    const userRes = await client.auth.getUser(token)
    if (userRes.error || !userRes.data?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const user = userRes.data.user

    // If visibilityMode is 'all', perform a paged query directly
    if (visibilityMode === 'all') {
      const query = client
        .from('classrooms')
        .select('*, classroom_schedules (*)', { count: 'exact' })
      if (search) query.ilike('name', `%${search}%`)
      const { data, error, count } = await query.order('name').range(from, to)
      if (error) throw error
      return new Response(JSON.stringify({ classrooms: data || [], count: count || 0 }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // For visible/hidden filtering we need to fetch all and then filter by user's hidden prefs
    const chunkSize = Math.max(perPage, 250)
    const allClassrooms: any[] = []

    for (let offset = 0; ; offset += chunkSize) {
      let q = client.from('classrooms').select('*, classroom_schedules (*)')
      if (search) q = q.ilike('name', `%${search}%`)
      const { data, error } = await q.order('name').range(offset, offset + chunkSize - 1)
      if (error) throw error
      const chunk = data || []
      allClassrooms.push(...chunk)
      if (chunk.length < chunkSize) break
    }

    // Fetch visibility preferences for this user for classroom and class_session
    const { data: visData, error: visError } = await client
      .from('user_entity_visibility_preferences')
      .select('entity_type, entity_id')
      .eq('user_id', user.id)
      .in('entity_type', ['classroom', 'class_session'])

    if (visError) throw visError

    const hiddenClassroomIds = new Set<string>()
    const hiddenSessionIds = new Set<string>()
    (visData || []).forEach((r: any) => {
      if (r.entity_type === 'classroom') hiddenClassroomIds.add(r.entity_id)
      else if (r.entity_type === 'class_session') hiddenSessionIds.add(r.entity_id)
    })

    const filtered = allClassrooms.filter((c: any) => {
      const isHidden = !!c.id && hiddenClassroomIds.has(c.id)
      return visibilityMode === 'hidden' ? isHidden : !isHidden
    })

    const sliced = filtered.slice(from, to + 1)

    return new Response(JSON.stringify({ classrooms: sliced, count: filtered.length, hiddenClassroomIds: Array.from(hiddenClassroomIds), hiddenSessionIds: Array.from(hiddenSessionIds) }), {
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
