import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const start = url.searchParams.get('start') || ''
  const end = url.searchParams.get('end') || ''

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

    // Counts
    const studentsRes = await client.from('students').select('id', { count: 'exact' }).range(0, 0)
    const coursesRes = await client.from('courses').select('id', { count: 'exact' }).range(0, 0)

    const totalStudents = studentsRes.count || 0
    const activeCourses = coursesRes.count || 0

    // Pending reports (limit 20) - reusing logic similar to ReportQueryService.fetchIncompleteReportsInternal
    const todayStr = new Date().toISOString().slice(0, 10)
    const dateStr = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const pendingRes = await client
      .from('occurrence_reports')
      .select(`
        id,
        enrollments!inner(id, student_id, course_id, students(id, name)),
        class_occurrences!inner(id, occurrence_date, actual_start_time, original_start_time, class_session_id, class_sessions(id, name, classroom_id, classrooms(id, name))),
        content, is_completed, updated_at, attendance_status
      `)
      .eq('attendance_status', 'present')
      .gte('class_occurrences.occurrence_date', dateStr)
      .lte('class_occurrences.occurrence_date', todayStr)
      .limit(20)

    const pending = (pendingRes.data || []).map((r: any) => {
      const occ = r.class_occurrences
      const session = Array.isArray(occ?.class_sessions) ? occ.class_sessions[0] : occ?.class_sessions
      const classroom = Array.isArray(session?.classrooms) ? session.classrooms[0] : session?.classrooms
      const student = Array.isArray(r.enrollments?.students) ? r.enrollments.students[0] : r.enrollments?.students
      return {
        id: r.id,
        studentName: student?.name || 'Unknown',
        date: occ?.occurrence_date,
        className: session?.name || '-',
        classroomName: classroom?.name || '-',
        enrollmentId: r.enrollments?.id,
        isMissing: false
      }
    })

    // Occurrences between start and end if provided
    let occurrences: any[] = []
    if (start && end) {
      const occRes = await client
        .from('class_occurrences')
        .select(`*, class_sessions(name, time_zone, classrooms (name, color))`)
        .gte('occurrence_date', start)
        .lte('occurrence_date', end)
        .order('occurrence_date', { ascending: true })

      occurrences = (occRes.data || []).map((d: any) => ({
        id: d.id,
        occurrence_date: d.occurrence_date,
        actual_start_time: d.actual_start_time,
        actual_end_time: d.actual_end_time,
        sessionName: d.class_sessions?.name,
        classroomName: d.class_sessions?.classrooms?.name,
        classroomColor: d.class_sessions?.classrooms?.color,
        isConducted: d.is_conducted
      }))
    }

    return new Response(JSON.stringify({ stats: { totalStudents, activeCourses }, pendingReports: pending, occurrences }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
