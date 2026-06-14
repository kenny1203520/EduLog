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

    const userId = userRes.data.user.id

    // Look up teacher profile matching user_id
    const { data: teacher } = await client
      .from('teachers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle()
    const teacherId = teacher?.id

    // Counts (students & active courses)
    const studentsRes = await client.from('students').select('id', { count: 'exact' }).range(0, 0)
    const coursesRes = await client.from('courses').select('id', { count: 'exact' }).range(0, 0)

    const totalStudents = studentsRes.count || 0
    const activeCourses = coursesRes.count || 0

    // Pending reports count & list
    const todayStr = new Date().toISOString().slice(0, 10)
    const dateStr = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    // All pending reports with fields required to determine incompleteness
    const pendingRes = await client
      .from('occurrence_reports')
      .select(`
        id,
        content,
        lesson_id,
        progress_letter,
        class_participation,
        classroom_behavior,
        enrollments!inner(id, student_id, course_id, students(id, name)),
        class_occurrences!inner(id, occurrence_date, actual_start_time, original_start_time, class_session_id, teacher_ids, teacher_attendance, class_sessions(id, name, classroom_id, classrooms(id, name))),
        is_completed, updated_at, attendance_status
      `)
      .eq('attendance_status', 'present')
      .gte('class_occurrences.occurrence_date', dateStr)
      .lte('class_occurrences.occurrence_date', todayStr)
      .order('class_occurrences(occurrence_date)', { ascending: false })
    //   .limit(20)

    const pending = (pendingRes.data || []).filter((r: any) => {
      if (!teacherId) return false
      const occ = r.class_occurrences
      return (occ?.teacher_ids || []).includes(teacherId) && occ?.teacher_attendance?.[teacherId] === true
    }).map((r: any) => {
      const occ = r.class_occurrences
      const session = Array.isArray(occ?.class_sessions) ? occ.class_sessions[0] : occ?.class_sessions
      const classroom = Array.isArray(session?.classrooms) ? session.classrooms[0] : session?.classrooms
      const student = Array.isArray(r.enrollments?.students) ? r.enrollments.students[0] : r.enrollments?.students

      // Incompleteness checks (mirror ReportQueryService.fetchIncompleteReportsInternal)
      const hasContent = !!(r.content && typeof r.content === 'string' && r.content.trim().length > 0)
      const hasLesson = !!r.lesson_id
      const hasProgress = !!r.is_completed || !!(r.progress_letter && typeof r.progress_letter === 'string' && r.progress_letter.trim())
      const hasParticipation = r.class_participation != null && r.class_participation > 0
      const hasBehavior = r.classroom_behavior != null && r.classroom_behavior > 0

      const isIncomplete = !(hasContent && hasLesson && hasProgress && hasParticipation && hasBehavior)

      return {
        id: r.id,
        studentName: student?.name || 'Unknown',
        date: occ?.occurrence_date,
        className: session?.name || '-',
        classroomName: classroom?.name || '-',
        enrollmentId: r.enrollments?.id,
        // include a short preview to avoid sending large payloads
        contentPreview: hasContent ? (r.content || '').slice(0, 300) : '',
        missingContent: !hasContent,
        missingLesson: !hasLesson,
        missingProgress: !hasProgress,
        missingParticipation: !hasParticipation,
        missingBehavior: !hasBehavior,
        isMissing: isIncomplete
      }
    }).filter((r: any) => r.isMissing)

    const pendingReportsCount = pending.length || 0

    // Occurrences between start and end if provided
    let occurrences: any[] = []
    if (start && end) {
      const occRes = await client
        .from('class_occurrences')
        .select(`
          *,
          class_sessions (
            name,
            time_zone,
            classrooms (
              name,
              color
            )
          )
        `)
        .gte('occurrence_date', start)
        .lte('occurrence_date', end)
        .order('occurrence_date', { ascending: true })

      if (occRes.error) {
        throw occRes.error
      }
      
      const rawOccurrences = occRes.data || []
      
      // Perform teacher filtering on the server
      occurrences = rawOccurrences.filter((occ: any) => {
        if (occ.is_conducted !== true) return false
        if (teacherId) {
          const isAssigned = occ.teacher_ids?.includes(teacherId)
          const isAttending = occ.teacher_attendance?.[teacherId] === true
          return isAssigned && isAttending
        }
        return true
      })
    }

    return new Response(
      JSON.stringify({
        stats: {
          totalStudents,
          activeCourses,
          pendingReportsCount
        },
        pendingReports: pending,
        occurrences
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60'
        }
      }
    )
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})

