import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase configuration' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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

    const { data, error } = await client
      .from('holidays')
      .select(`
        id, start_date, end_date, time_zone, name, kind, classroom_ids, class_session_ids, teacher_ids, created_at, updated_at
      `)
      .order('start_date', { ascending: false })

    if (error) throw error

    // Optionally expand classroom/session names if client requests via query param ?expand=true
    const url = new URL(req.url)
    const expand = url.searchParams.get('expand') === 'true'

    let results = data || []

    if (expand && results.length) {
      // Flatten unique ids
      const classroomIds = Array.from(new Set(results.flatMap((r: any) => r.classroom_ids || [])))
      const sessionIds = Array.from(new Set(results.flatMap((r: any) => r.class_session_ids || [])))
      const teacherIds = Array.from(new Set(results.flatMap((r: any) => r.teacher_ids || [])))

      const classroomsMap: Record<string, any> = {}
      if (classroomIds.length) {
        const cRes = await client.from('classrooms').select('id, name').in('id', classroomIds)
        for (const c of cRes.data || []) classroomsMap[c.id] = c
      }

      const sessionsMap: Record<string, any> = {}
      if (sessionIds.length) {
        const sRes = await client.from('class_sessions').select('id, name').in('id', sessionIds)
        for (const s of sRes.data || []) sessionsMap[s.id] = s
      }

      const teachersMap: Record<string, any> = {}
      if (teacherIds.length) {
        const tRes = await client.from('teachers').select('id, name').in('id', teacherIds)
        for (const t of tRes.data || []) teachersMap[t.id] = t
      }

      results = results.map((r: any) => ({
        ...r,
        classroomNames: (r.classroom_ids || []).map((id: string) => classroomsMap[id]?.name || '').filter(Boolean),
        classSessionNames: (r.class_session_ids || []).map((id: string) => sessionsMap[id]?.name || '').filter(Boolean),
        teacherNames: (r.teacher_ids || []).map((id: string) => teachersMap[id]?.name || '').filter(Boolean)
      }))
    }

    return new Response(JSON.stringify(results), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
