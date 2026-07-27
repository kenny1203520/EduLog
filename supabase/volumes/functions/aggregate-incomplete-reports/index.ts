import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function isTeacherPresentForScope(
  teacherId: string,
  teacherUserId: string | null | undefined,
  occurrenceTeacherIds: string[] = [],
  teacherAttendance: Record<string, boolean> = {},
): boolean {
  const teacherKeys = [teacherId, teacherUserId].filter(Boolean) as string[]
  const isAssigned = teacherKeys.some((key) => occurrenceTeacherIds.includes(key))
  if (!isAssigned) return false

  const attendanceValues = teacherKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(teacherAttendance, key))
    .map((key) => teacherAttendance[key])

  if (attendanceValues.some((value) => value === false)) return false
  return attendanceValues.some((value) => value === true)
}

function resolveNotificationRoleIds(rules: any[], classroomId?: string, sessionId?: string): string[] {
  const sessionRules = rules.filter(rule => rule.scope_type === 'class_session' && rule.class_session_id === sessionId)
  if (sessionRules.length) return [...new Set(sessionRules.map(rule => rule.role_type_id))] as string[]
  const classroomRules = rules.filter(rule => rule.scope_type === 'classroom' && rule.classroom_id === classroomId)
  if (classroomRules.length) return [...new Set(classroomRules.map(rule => rule.role_type_id))] as string[]
  return [...new Set(rules.filter(rule => rule.scope_type === 'global').map(rule => rule.role_type_id))] as string[]
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const url = new URL(req.url)
  const daysBack = Number(url.searchParams.get('daysBack') || '90')
  const requestedScope = url.searchParams.get('scope')
  const scope = requestedScope === 'my_present' || requestedScope === 'my_notifications' ? requestedScope : 'all'
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
    let teacherId = ''
    let teacherUserId = ''
    if (scope === 'my_present' || scope === 'my_notifications') {
      const { data: teacher, error: teacherError } = await client
        .from('teachers')
        .select('id, user_id')
        .eq('user_id', userId)
        .maybeSingle()

      if (teacherError) throw teacherError
      teacherId = teacher?.id || ''
      teacherUserId = teacher?.user_id || userId
      if (!teacherId) {
        return new Response(JSON.stringify([]), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    const todayStr = new Date().toISOString().slice(0, 10)
    const dateStr = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data, error } = await client
      .from('occurrence_reports')
      .select(`
        *,
        enrollments!inner (
          id, student_id, course_id, students (id, name)
        ),
        class_occurrences!inner (
          id, occurrence_date, actual_start_time, actual_end_time, original_start_time, original_end_time, time_zone, is_conducted, teacher_ids, teacher_attendance,
          class_sessions ( id, name, classroom_id, classrooms ( id, name ) )
        )
      `)
      .eq('attendance_status', 'present')
      .gte('class_occurrences.occurrence_date', dateStr)
      .lte('class_occurrences.occurrence_date', todayStr)

    if (error) throw error
    if (!data) return new Response(JSON.stringify([]), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    let notificationAssignments: any[] = []
    let notificationRules: any[] = []
    if (scope === 'my_notifications') {
      const sessionIds = [...new Set(data.map((report: any) => {
        const occurrence = report.class_occurrences
        const relatedSession = Array.isArray(occurrence?.class_sessions) ? occurrence.class_sessions[0] : occurrence?.class_sessions
        return relatedSession?.id
      }).filter(Boolean))] as string[]
      const [assignmentsResult, rulesResult] = await Promise.all([
        sessionIds.length
          ? client.from('class_session_teachers').select('class_session_id, role_type_id, effective_from, effective_to').eq('teacher_id', teacherId).in('class_session_id', sessionIds)
          : Promise.resolve({ data: [], error: null }),
        client.from('incomplete_report_notification_rules').select('scope_type, classroom_id, class_session_id, role_type_id')
      ])
      if (assignmentsResult.error) throw assignmentsResult.error
      if (rulesResult.error) throw rulesResult.error
      notificationAssignments = assignmentsResult.data || []
      notificationRules = rulesResult.data || []
    }

    const results: any[] = []
    for (const report of data) {
      const hasContent = !!(report.content && report.content.trim().length > 0)
      const hasLesson = !!report.lesson_id
      const hasProgress = report.is_completed || !!(report.progress_letter && report.progress_letter.trim())
      const hasParticipation = report.class_participation != null && report.class_participation > 0
      const hasBehavior = report.classroom_behavior != null && report.classroom_behavior > 0

      const isIncomplete = !(hasContent && hasLesson && hasProgress && hasParticipation && hasBehavior)
      if (!isIncomplete) continue

      const occ = report.class_occurrences
      const session = Array.isArray(occ?.class_sessions) ? occ.class_sessions[0] : occ?.class_sessions
      const classroom = Array.isArray(session?.classrooms) ? session.classrooms[0] : session?.classrooms
      if (scope === 'my_present') {
        if (!isTeacherPresentForScope(teacherId, teacherUserId, occ?.teacher_ids || [], occ?.teacher_attendance || {})) continue
      }
      if (scope === 'my_notifications') {
        const targetRoleIds = resolveNotificationRoleIds(notificationRules, classroom?.id || session?.classroom_id, session?.id)
        if (targetRoleIds.length === 0) {
          // No rules configured yet: keep the legacy "teacher present" behavior.
          if (!isTeacherPresentForScope(teacherId, teacherUserId, occ?.teacher_ids || [], occ?.teacher_attendance || {})) continue
        } else {
          const assignmentMatches = notificationAssignments.some(assignment =>
            assignment.class_session_id === session?.id
            && assignment.effective_from <= occ?.occurrence_date
            && (!assignment.effective_to || assignment.effective_to >= occ?.occurrence_date)
            && targetRoleIds.includes(assignment.role_type_id)
          )
          if (!assignmentMatches) continue
        }
      }
      const student = Array.isArray(report.enrollments?.students) ? report.enrollments.students[0] : report.enrollments?.students

      results.push({
        id: report.id,
        reportId: report.id,
        enrollmentId: report.enrollment_id,
        occurrenceId: report.class_occurrence_id,
        studentName: student?.name || 'Unknown',
        courseId: report.enrollments?.course_id,
        className: session?.name || '-',
        classroomName: classroom?.name || '-',
        date: occ?.occurrence_date,
        timeZone: occ?.time_zone,
        startTime: occ?.actual_start_time || occ?.original_start_time || undefined,
        endTime: occ?.actual_end_time || occ?.original_end_time || undefined,
        content: report.content || '',
        contentDocument: report.content_document,
        lessonId: report.lesson_id,
        missingContent: !hasContent,
        missingLesson: !hasLesson,
        missingProgress: !hasProgress,
        missingParticipation: !hasParticipation,
        missingBehavior: !hasBehavior,
        version: report.version,
        attendanceStatus: report.attendance_status,
        absenceReason: report.absence_reason,
        classParticipation: report.class_participation,
        classroomBehavior: report.classroom_behavior,
        contactNotes: report.contact_notes,
        contactNotesDocument: report.contact_notes_document,
        classNotes: report.class_notes,
        classNotesDocument: report.class_notes_document,
        externalLink: report.external_link,
        updatedAt: report.updated_at,
        isCompleted: report.is_completed,
        progressLetter: report.progress_letter,
        fullStudent: student,
        isMissing: false
      })
    }

    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    return new Response(JSON.stringify(results), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60' } })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
