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
        const results = await this.fetchIncompleteReportsInternal(90)
        return results.map(r => ({
            id: r.id,
            studentName: r.studentName,
            date: r.date,
            className: r.className,
            classroom: r.classroomName,
            occurrenceId: r.occurrenceId,
            enrollmentId: r.enrollmentId,
            isMissing: false,
            reportId: r.id
        }))
    }

    static async getGlobalIncompleteReports(): Promise<any[]> {
        return this.fetchIncompleteReportsInternal(90)
    }

    private static async fetchIncompleteReportsInternal(daysBack: number): Promise<any[]> {
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - daysBack)
        const dateStr = startDate.toISOString().split('T')[0]
        const todayStr = new Date().toISOString().split('T')[0]

        // Fetch reports with attendance_status = 'present'
        // Join with everything needed to determine incompleteness and show details
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select(`
                *,
                enrollments!inner (
                    id, student_id, course_id, status,
                    students (id, name)
                ),
                class_occurrences!inner (
                    id, occurrence_date, actual_start_time, actual_end_time, original_start_time, original_end_time, is_conducted, status,
                    class_sessions (
                        id, name,
                        classrooms (id, name)
                    )
                )
            `)
            .eq('attendance_status', 'present')
            .gte('class_occurrences.occurrence_date', dateStr)
            .lte('class_occurrences.occurrence_date', todayStr)

        if (error) throw new Error(`Failed to fetch incomplete reports: ${error.message}`)
        if (!data) return []

        const results: any[] = []
        for (const report of data) {
            // Check incompleteness based on user's rules:
            // 課堂秩序、課程參與、課次、進度紀錄(如果完整完成則可以省略)、學習報告 以上任一位完成則為缺失
            const hasContent = !!(report.content && report.content.trim().length > 0)
            const hasLesson = !!report.lesson_id
            const hasProgress = report.is_completed || !!(report.progress_letter && report.progress_letter.trim())
            const hasParticipation = report.class_participation != null && report.class_participation > 0
            const hasBehavior = report.classroom_behavior != null && report.classroom_behavior > 0

            const isIncomplete = !(hasContent && hasLesson && hasProgress && hasParticipation && hasBehavior)
            
            if (isIncomplete) {
                const occ = report.class_occurrences
                const session = Array.isArray(occ.class_sessions) ? occ.class_sessions[0] : occ.class_sessions
                const classroom = Array.isArray(session?.classrooms) ? session.classrooms[0] : session?.classrooms
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
                    date: occ.occurrence_date,
                    startTime: occ.actual_start_time || occ.original_start_time || undefined,
                    endTime: occ.actual_end_time || occ.original_end_time || undefined,
                    content: report.content || '',
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
                    classNotes: report.class_notes,
                    externalLink: report.external_link,
                    updatedAt: report.updated_at,
                    isCompleted: report.is_completed,
                    progressLetter: report.progress_letter,
                    fullStudent: student,
                    isMissing: false
                })
            }
        }

        return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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

}
