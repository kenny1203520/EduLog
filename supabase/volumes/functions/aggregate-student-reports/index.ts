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
  const enrollmentId = url.searchParams.get('enrollment_id')
  const page = Number(url.searchParams.get('page') || '1')
  const perPage = Number(url.searchParams.get('perPage') || '50')
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  if (!enrollmentId) {
    return new Response(JSON.stringify({ error: 'Missing enrollment_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

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
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to validate token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  try {
    const enrollmentP = client
      .from('enrollments')
      .select(`*, students (*), courses (*), classrooms (*)`)
      .eq('id', enrollmentId)
      .maybeSingle()

    const reportsP = client
      .from('occurrence_reports')
      .select(`
        *,
        class_occurrence:class_occurrences!class_occurrence_id(*, class_sessions:class_sessions!class_session_id(id, name, classroom:classrooms!classroom_id(id, name))),
        lesson:lessons!lesson_id(id, title, sequence)
      `, { count: 'exact' })
      .eq('enrollment_id', enrollmentId)
      .order('class_occurrence(occurrence_date)', { ascending: false })
      .range(from, to)

    const [enrollmentRes, reportsRes] = await Promise.all([enrollmentP, reportsP])

    if (enrollmentRes.error) throw enrollmentRes.error
    if (reportsRes.error) throw reportsRes.error

    const enrollment = enrollmentRes.data || null
    const reports = reportsRes.data || []
    const count = reportsRes.count || 0

    return new Response(JSON.stringify({ enrollment, reports, count }), {
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
