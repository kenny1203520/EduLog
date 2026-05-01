import { supabase } from '@/lib/supabase'
import { OccurrenceReport, ReportVersion, type OccurrenceReportDTO } from '@/models/OccurrenceReport'

export class ReportQueryService {
    static async getReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport | null> {
        const { data: existing, error } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', occurrenceId)
            .maybeSingle()

        if (error) throw new Error(`Failed to fetch report: ${error.message}`)

        return existing ? new OccurrenceReport(existing) : null
    }

    static async getReportVersions(reportId: string): Promise<ReportVersion[]> {
        const { data, error } = await supabase
            .from('report_versions')
            .select('*')
            .eq('occurrence_report_id', reportId)
            .order('version', { ascending: false })

        if (error) throw new Error(`Failed to fetch versions: ${error.message}`)

        return (data || []).map(dto => new ReportVersion(dto))
    }

    static async getReportsByEnrollment(
        enrollmentId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: OccurrenceReport[], count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        const { data, error, count } = await supabase
            .from('occurrence_reports')
            .select(`
                *,
                class_occurrences!class_occurrence_id (
                    occurrence_date
                )
            `, { count: 'exact' })
            .eq('enrollment_id', enrollmentId)
            .order('created_at', { ascending: false })
            .range(from, to)

        if (error) throw new Error(error.message)

        return {
            data: (data || []).map((dto: any) => {
                const occurrenceDate = dto.class_occurrences?.occurrence_date
                const mappedDto: OccurrenceReportDTO = {
                    ...dto,
                    occurrence_date: occurrenceDate
                }
                return new OccurrenceReport(mappedDto)
            }),
            count: count || 0
        }
    }

    static async getAllReportsByEnrollment(enrollmentId: string): Promise<OccurrenceReport[]> {
        const pageSize = 100
        let page = 1
        const allReports: OccurrenceReport[] = []

        while (true) {
            const { data, count } = await this.getReportsByEnrollment(enrollmentId, page, pageSize)
            allReports.push(...data)

            if (data.length < pageSize || allReports.length >= (count || 0)) {
                break
            }

            page += 1
        }

        return allReports
    }

    static async getReportsByOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('class_occurrence_id', occurrenceId)
            .order('created_at', { ascending: false })

        if (error) throw new Error(error.message)

        return (data || []).map(dto => new OccurrenceReport(dto))
    }

    static async getReportById(reportId: string): Promise<OccurrenceReport> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (error) throw new Error(error.message)

        return new OccurrenceReport(data)
    }

    static async getReportsWithDetails(
        enrollmentId: string
    ): Promise<any[]> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select(`
                *,
                class_occurrence:class_occurrences!class_occurrence_id(
                    *,
                    class_session:class_sessions!class_session_id(
                        name,
                        classroom:classrooms!classroom_id(name)
                    )
                ),
                lesson:lessons!lesson_id(id, title, sequence)
            `)
            .eq('enrollment_id', enrollmentId)
            .order('class_occurrence(occurrence_date)', { ascending: false })

        if (error) throw new Error(error.message)

        return data || []
    }

    static async getPendingReports(): Promise<any[]> {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0]

        const { data: occurrences, error: occError } = await supabase
            .from('class_occurrences')
            .select(`
                id, occurrence_date, is_conducted,
                class_sessions (
                    id, name,
                    classrooms (name),
                    enrollments (
                        id, student_id, status,
                        students (name)
                    )
                )
            `)
            .eq('is_conducted', true)
            .gte('occurrence_date', dateStr)
            .lte('occurrence_date', new Date().toISOString().split('T')[0])

        if (occError) throw new Error(`Failed to fetch pending reports: ${occError.message}`)
        if (!occurrences) return []

        const pending: any[] = []
        const occurrenceIds = occurrences.map(o => o.id)
        if (occurrenceIds.length === 0) return []

        const { data: reports } = await supabase
            .from('occurrence_reports')
            .select('id, enrollment_id, class_occurrence_id, is_completed, attendance_status, content, lesson_id, progress_letter')
            .in('class_occurrence_id', occurrenceIds)

        const reportLookup = new Map<string, any>()
        reports?.forEach(r => {
            reportLookup.set(`${r.enrollment_id}_${r.class_occurrence_id}`, r)
        })

        for (const occ of occurrences) {
            const session = (occ as any).class_sessions
            if (!session || !session.enrollments) continue

            for (const enr of session.enrollments) {
                if (enr.status !== 'active') continue

                const key = `${enr.id}_${occ.id}`
                const report = reportLookup.get(key)

                if (report && report.attendance_status === 'present') {
                    const hasRange = report.progress_letter && report.progress_letter.includes('-')
                    const isProgressDone = report.is_completed || hasRange
                    const hasContent = report.content && report.content.trim().length > 0

                    if (!isProgressDone && !hasContent) {
                        pending.push({
                            id: report.id,
                            studentName: enr.students?.name || 'Unknown',
                            date: occ.occurrence_date,
                            className: session.name,
                            classroom: session.classrooms?.name,
                            occurrenceId: occ.id,
                            enrollmentId: enr.id,
                            isMissing: true
                        })
                    }
                }
            }
        }

        return pending.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    }

    static async getReportsByLesson(
        lessonId: string,
        params: {
            excludeReportId?: string,
            page?: number,
            pageSize?: number,
            classroomId?: string,
            sessionId?: string,
            sortBy?: 'asc' | 'desc',
            search?: string
        } = {}
    ): Promise<{ data: any[], count: number }> {
        const { page = 1, pageSize = 10, excludeReportId, classroomId, sessionId, sortBy = 'desc', search } = params
        const from = (page - 1) * pageSize
        const to = from + pageSize - 1

        let query = supabase
            .from('occurrence_reports')
            .select(`
                id, content, is_completed, updated_at,
                progress_letter,
                contact_notes, class_notes,
                enrollments!inner (
                    students (name)
                ),
                class_occurrences!inner (
                    occurrence_date,
                    original_start_time,
                    class_session_id,
                    class_sessions!inner (
                        name,
                        classroom_id,
                        classrooms!inner (name)
                    )
                )
            `, { count: 'exact' })
            .eq('lesson_id', lessonId)
            .not('content', 'is', null)
            .neq('content', '')

        if (excludeReportId) {
            query = query.neq('id', excludeReportId)
        }

        if (search) {
            query = query.ilike('content', `%${search}%`)
        }

        if (classroomId) {
            query = query.eq('class_occurrences.class_sessions.classroom_id', classroomId)
        }

        if (sessionId) {
            query = query.eq('class_occurrences.class_session_id', sessionId)
        }

        const { data, error, count } = await query
            .order('class_occurrences(occurrence_date)', { ascending: sortBy === 'asc' })
            .order('class_occurrences(original_start_time)', { ascending: sortBy === 'asc' })
            .range(from, to)

        if (error) throw new Error(error.message)
        return { data: data || [], count: count || 0 }
    }

    static async getReportsByStudent(
        studentId: string,
        params: {
            excludeReportId?: string,
            page?: number,
            pageSize?: number,
            courseId?: string,
            sortBy?: 'asc' | 'desc',
            search?: string
        } = {}
    ): Promise<{ data: any[], count: number }> {
        const { page = 1, pageSize = 10, excludeReportId, courseId, sortBy = 'desc', search } = params
        const from = (page - 1) * pageSize
        const to = from + pageSize - 1

        const { data: enrollments } = await supabase
            .from('enrollments')
            .select('id')
            .eq('student_id', studentId)

        if (!enrollments?.length) return { data: [], count: 0 }

        const enrollmentIds = enrollments.map(e => e.id)

        let query = supabase
            .from('occurrence_reports')
            .select(`
                id, content, is_completed, updated_at,
                progress_letter,
                contact_notes, class_notes,
                lessons (title, sequence),
                enrollments!inner (
                    courses (id, subject, display_name)
                ),
                class_occurrences!inner (
                    occurrence_date,
                    original_start_time,
                    class_sessions!inner (
                        name
                    )
                )
            `, { count: 'exact' })
            .in('enrollment_id', enrollmentIds)
            .not('content', 'is', null)
            .neq('content', '')

        if (excludeReportId) {
            query = query.neq('id', excludeReportId)
        }

        if (search) {
            query = query.ilike('content', `%${search}%`)
        }

        if (courseId) {
            query = query.eq('enrollments.course_id', courseId)
        }

        const { data, error, count } = await query
            .order('class_occurrences(occurrence_date)', { ascending: sortBy === 'asc' })
            .order('class_occurrences(original_start_time)', { ascending: sortBy === 'asc' })
            .range(from, to)

        if (error) throw new Error(error.message)

        return { data: data || [], count: count || 0 }
    }

    static async getGlobalIncompleteReports(): Promise<any[]> {
        // Use date-only comparison (YYYY-MM-DD) to match DB date column
        const todayStr = new Date().toISOString().split('T')[0]

        const { data, error } = await supabase
            .from('occurrence_reports')
            .select(`
                id,
                content,
                lesson_id,
                attendance_status,
                is_completed,
                version,
                updated_at,
                enrollment_id,
                class_occurrence_id,
                enrollments (
                    id,
                    student_id,
                    course_id,
                    students (
                        id,
                        name
                    )
                ),
                class_occurrences!inner (
                    id,
                    occurrence_date,
                    original_start_time,
                    actual_start_time,
                    class_sessions (
                        id,
                        name,
                        classrooms (
                            id,
                            name
                        )
                    )
                )
            `)
            .eq('attendance_status', 'present')
            .lte('class_occurrences.occurrence_date', todayStr)
            .order('class_occurrences(occurrence_date)', { ascending: false })

        if (error) throw new Error(`Failed to fetch incomplete reports: ${error.message}`)

        return (data || [])
            .filter(r => {
                const row: any = r
                const hasContent = row.content && row.content.trim().length > 0
                const hasLesson = !!row.lesson_id
                return !(hasContent && hasLesson)
            })
            .map(r => {
                const row: any = r
                const classOcc = row.class_occurrences || {}
                const classSession = Array.isArray(classOcc.class_sessions) 
                    ? classOcc.class_sessions[0] 
                    : classOcc.class_sessions || {}
                const classroom = Array.isArray(classSession.classrooms)
                    ? classSession.classrooms[0]
                    : classSession.classrooms || {}
                const students = Array.isArray(row.enrollments?.students)
                    ? row.enrollments.students
                    : [row.enrollments?.students].filter(Boolean)
                const student = students[0]
                const hasContent = hasContentSafe(row.content)
                const hasLesson = !!row.lesson_id

                return {
                    id: row.id,
                    reportId: row.id,
                    enrollmentId: row.enrollment_id,
                    occurrenceId: row.class_occurrence_id,
                    studentName: student?.name || row.enrollments?.students?.name || 'Unknown',
                    courseId: row.enrollments?.course_id,
                    className: classSession?.name || '-',
                    classroomName: classroom?.name || '-',
                    date: classOcc.occurrence_date,
                    startTime: classOcc.actual_start_time || classOcc.original_start_time || undefined,
                    content: row.content || '',
                    lessonId: row.lesson_id || null,
                    missingContent: !hasContent,
                    missingLesson: !hasLesson,
                    version: row.version,
                    attendanceStatus: row.attendance_status,
                    updatedAt: row.updated_at,
                    isCompleted: row.is_completed
                }
            })
    }
}

function hasContentSafe(content?: string | null): boolean {
    return !!content && content.trim().length > 0
}
