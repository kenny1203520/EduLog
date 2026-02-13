import { supabase } from '@/lib/supabase'
import {
    OccurrenceReport,
    type OccurrenceReportDTO,
    ReportVersion,
    type SaveReportResult
} from '@/models/OccurrenceReport'
import { EnrollmentProgressService } from './EnrollmentProgressService'
import { OccurrenceService } from './OccurrenceService'
import { HolidayService } from './HolidayService'
import { SuspensionService } from './SuspensionService'

/**
 * OccurrenceReportService handles business logic for occurrence reports.
 * Implements auto-save functionality and conflict resolution.
 * 
 * Following Single Responsibility Principle - only handles report operations.
 */
export class OccurrenceReportService {
    /**
     * Gets or creates a report for a specific enrollment and occurrence.
     * This ensures every student-occurrence pair has a report.
     * 
     * @param enrollmentId - The enrollment ID
     * @param occurrenceId - The class occurrence ID
     * @returns The report (existing or newly created)
     */
    // Fetches an existing report without creating one
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

    // Explicitly creates a new report
    static async createReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        // 1. Fetch occurrence and session info to check for holiday scope
        const { data: occurrence } = await supabase
            .from('class_occurrences')
            .select(`
                occurrence_date,
                class_session_id,
                class_sessions (
                    classroom_id
                )
            `)
            .eq('id', occurrenceId)
            .single()

        const classroomId = (occurrence?.class_sessions as any)?.classroom_id
        const sessionId = occurrence?.class_session_id

        const isHoliday = occurrence
            ? await HolidayService.isHoliday(occurrence.occurrence_date, classroomId, sessionId)
            : false

        // Check for student suspension
        const isSuspended = occurrence
            ? await SuspensionService.isSuspended(enrollmentId, occurrence.occurrence_date)
            : false

        // 2. Create new report
        const newReport: Partial<OccurrenceReportDTO> = {
            enrollment_id: enrollmentId,
            class_occurrence_id: occurrenceId,
            content: '',
            version: 1,
            attendance_status: (isHoliday || isSuspended) ? 'absent' : 'pending',
            absence_reason: isSuspended ? 'suspension' : (isHoliday ? 'holiday' : undefined),
            is_completed: false // Default to false (scheduled) instead of true (present)
        }

        const { data: created, error: createError } = await supabase
            .from('occurrence_reports')
            .insert(newReport)
            .select()
            .single()

        if (createError) throw new Error(`Failed to create report: ${createError.message}`)

        return new OccurrenceReport(created)
    }

    static async getOrCreateReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        // Try to fetch existing report
        const existing = await this.getReport(enrollmentId, occurrenceId)
        if (existing) return existing

        // If not found, create it
        return this.createReport(enrollmentId, occurrenceId)
    }

    /**
     * Saves a report with optimistic locking (version check).
     * Returns conflict status if version mismatch detected.
     * Also handles automatic progress tracking based on lesson completion.
     * 
     * @param reportId - The report ID
     * @param currentVersion - Client's current version
     * @param userId - User making the edit (optional)
     * @param detailedData - All detailed report fields
     * @returns Save result with conflict status
     */
    static async saveReport(
        reportId: string,
        currentVersion: number,
        userId?: string,
        detailedData?: {
            lessonId?: string
            isCompleted?: boolean
            progressLetter?: string
            attendanceStatus?: 'present' | 'absent' | 'pending'
            absenceReason?: string
            classParticipation?: number
            classroomBehavior?: number
            contactNotes?: string
            classNotes?: string
            content: string,
            externalLink?: string
        }
    ): Promise<SaveReportResult> {
        // Fetch current server version with ALL fields for conflict resolution
        const { data: serverReport, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (fetchError) {
            return {
                success: false,
                conflict: false,
                message: `Failed to fetch report: ${fetchError.message}`
            }
        }

        // Check for version conflict
        if (serverReport.version !== currentVersion) {
            return {
                success: false,
                conflict: true,
                serverContent: serverReport.content,
                serverReport: serverReport, // Return full DTO
                message: 'Conflict detected: Report was modified by another user'
            }
        }

        // No conflict - proceed with save
        const newVersion = currentVersion + 1

        const updateData: any = {
            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }

        // Add detailed fields if provided
        if (detailedData) {
            // Apply business rules
            let isCompleted = detailedData.isCompleted ?? true
            let progressLetter = detailedData.progressLetter || null

            // Rule: Absent → force incomplete
            if (detailedData.attendanceStatus === 'absent') {
                isCompleted = false
            }

            // Add all fields to update data
            if (detailedData.lessonId !== undefined) {
                updateData.lesson_id = detailedData.lessonId
            }
            if (detailedData.externalLink !== undefined) {
                updateData.external_link = detailedData.externalLink
            }
            updateData.is_completed = isCompleted

            if (progressLetter !== undefined) {
                updateData.progress_letter = progressLetter
            }
            if (detailedData.attendanceStatus !== undefined) {
                updateData.attendance_status = detailedData.attendanceStatus
            }
            if (detailedData.absenceReason !== undefined) {
                updateData.absence_reason = detailedData.absenceReason
            }
            if (detailedData.classParticipation !== undefined) {
                updateData.class_participation = detailedData.classParticipation
            }
            if (detailedData.classroomBehavior !== undefined) {
                updateData.classroom_behavior = detailedData.classroomBehavior
            }
            if (detailedData.contactNotes !== undefined) {
                updateData.contact_notes = detailedData.contactNotes
            }
            if (detailedData.classNotes !== undefined) {
                updateData.class_notes = detailedData.classNotes
            }
            if (detailedData.content !== undefined) {
                updateData.content = detailedData.content
            }
        }

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updateData)
            .eq('id', reportId)
            .eq('version', currentVersion) // Double-check version (race condition protection)
            .select()
            .single()

        if (updateError) {
            // Check if it's a concurrent update
            if (updateError.code === 'PGRST116') {
                return {
                    success: false,
                    conflict: true,
                    message: 'Conflict detected: Concurrent modification'
                }
            }

            return {
                success: false,
                conflict: false,
                message: `Failed to save report: ${updateError.message}`
            }
        }

        // Auto-update enrollment progress if lesson info provided
        if (detailedData?.lessonId && detailedData?.isCompleted !== undefined) {
            try {
                await this.updateEnrollmentProgressAfterReport(
                    serverReport.enrollment_id,
                    reportId,
                    detailedData.lessonId,
                    detailedData.isCompleted
                )
            } catch (progressError: any) {
                console.error('Failed to update progress:', progressError)
                // Don't fail the save if progress update fails
            }
        }

        return {
            success: true,
            conflict: false,
            newVersion: updated.version
        }
    }

    /**
     * Gets all version history for a report
     */
    static async getReportVersions(reportId: string): Promise<ReportVersion[]> {
        const { data, error } = await supabase
            .from('report_versions')
            .select('*')
            .eq('occurrence_report_id', reportId)
            .order('version', { ascending: false })

        if (error) throw new Error(`Failed to fetch versions: ${error.message}`)

        return data.map(dto => new ReportVersion(dto))
    }

    /**
     * Restores a report to a specific version from history.
     */
    static async restoreReportVersion(
        reportId: string,
        versionId: string,
        userId?: string
    ): Promise<OccurrenceReport> {
        // 1. Fetch the version data
        const { data: version, error: versionError } = await supabase
            .from('report_versions')
            .select('*')
            .eq('id', versionId)
            .single()

        if (versionError || !version) throw new Error(`Failed to fetch version: ${versionError?.message}`)

        // 2. Determine what to restore
        // Prefer snapshot if available, otherwise just content
        let updatePayload: any = {}

        if (version.snapshot) {
            const snap = version.snapshot
            updatePayload = {
                lesson_id: snap.lesson_id,
                is_completed: snap.is_completed,
                progress_letter: snap.progress_letter,
                attendance_status: snap.attendance_status,
                absence_reason: snap.absence_reason,
                class_participation: snap.class_participation,
                classroom_behavior: snap.classroom_behavior,
                contact_notes: snap.contact_notes,
                class_notes: snap.class_notes,
                content: snap.content,
                external_link: snap.external_link
            }
        } else {
            // Legacy restoration - only content
            updatePayload = {
                content: version.content
            }
        }

        // 3. Increment version on the report
        const { data: current } = await supabase
            .from('occurrence_reports')
            .select('version')
            .eq('id', reportId)
            .single()

        const newVersion = (current?.version || 0) + 1

        updatePayload.version = newVersion
        updatePayload.last_edited_by = userId
        updatePayload.last_edited_at = new Date().toISOString()

        // 4. Update the report
        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updatePayload)
            .eq('id', reportId)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to restore version: ${updateError.message}`)

        return new OccurrenceReport(updated)
    }

    /**
     * Helper method to update enrollment progress after saving a report
     * Also checks if this is the last lesson and auto-completes enrollment
     * @private
     */
    private static async updateEnrollmentProgressAfterReport(
        enrollmentId: string,
        reportId: string,
        lessonId: string,
        isCompleted: boolean
    ): Promise<void> {
        // 1. Get lesson details
        const { data: lesson, error: lessonError } = await supabase
            .from('lessons')
            .select('id, sequence, course_id')
            .eq('id', lessonId)
            .single()

        if (lessonError || !lesson) return

        // 2. Get all lessons in this course to check for completion
        const { data: allLessonsData } = await supabase
            .from('lessons')
            .select('id, sequence')
            .eq('course_id', lesson.course_id)
            .order('sequence', { ascending: true })

        if (!allLessonsData || allLessonsData.length === 0) return

        const lastLesson = allLessonsData[allLessonsData.length - 1]
        const isActuallyLastLesson = lastLesson?.id === lessonId

        // 3. Auto-complete enrollment if the last lesson is finished
        if (isCompleted && isActuallyLastLesson) {
            await supabase
                .from('enrollments')
                .update({ status: 'completed' })
                .eq('id', enrollmentId)

            return
        }

        // 4. Update progress letter/sequence
        const allLessons = allLessonsData.map(l => ({
            id: l.id,
            sequence: l.sequence
        })) as any

        await EnrollmentProgressService.calculateNewProgress(
            enrollmentId,
            lesson.sequence,
            isCompleted,
            allLessons
        )

        // 5. Auto-extension logic
        // If this is the last generated report and course is not finished, generate one more week
        const { data: currentReport } = await supabase
            .from('occurrence_reports')
            .select('id, class_occurrence:class_occurrences!class_occurrence_id(id, occurrence_date, class_session_id)')
            .eq('id', reportId)
            .single()

        if (!currentReport || !currentReport.class_occurrence) return

        const currentOcc = currentReport.class_occurrence as any
        const todayStr = currentOcc.occurrence_date

        // Count reports after this one
        const { count } = await supabase
            .from('occurrence_reports')
            .select('id, class_occurrence:class_occurrences!class_occurrence_id(occurrence_date)', { count: 'exact', head: true })
            .eq('enrollment_id', enrollmentId)
            .gt('class_occurrence.occurrence_date', todayStr)

        if (!count || count === 0) {
            if (!isCompleted || !isActuallyLastLesson) {
                const nextWeek = new Date(todayStr)
                nextWeek.setDate(nextWeek.getDate() + 7)
                const nextWeekStr = nextWeek.toISOString().split('T')[0]

                await OccurrenceService.generateOccurrences(
                    currentOcc.class_session_id,
                    nextWeek,
                    nextWeek
                )

                const { data: nextOcc } = await supabase
                    .from('class_occurrences')
                    .select('id')
                    .eq('class_session_id', currentOcc.class_session_id)
                    .eq('occurrence_date', nextWeekStr)
                    .single()

                if (nextOcc) {
                    await supabase.from('occurrence_reports').insert({
                        enrollment_id: enrollmentId,
                        class_occurrence_id: nextOcc.id,
                        content: '',
                        version: 1,
                        is_completed: false,
                        attendance_status: 'pending'
                    })
                }
            }
        }
    }

    /**
     * Resolves a conflict by forcing an update.
     * This overwrites the server version with the resolved content.
     * 
     * @param reportId - The report ID
     * @param resolvedReport - The report after manual resolution
     * @param userId - User resolving the conflict
     * @returns Updated report
     */
    static async resolveConflict(
        reportId: string,
        resolvedReport: OccurrenceReportDTO,
        userId?: string
    ): Promise<OccurrenceReport> {
        // Fetch current report to get version
        const { data: current, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (fetchError) throw new Error(`Failed to fetch report: ${fetchError.message}`)

        // Force update with new version
        const newVersion = current.version + 1

        // Sanitize payload to avoid UUID errors and restricted field updates
        const updatePayload: any = {
            // UUID fields: convert empty string to null to prevent "invalid input syntax for type uuid"
            lesson_id: resolvedReport.lesson_id || null,

            is_completed: resolvedReport.is_completed,
            progress_letter: resolvedReport.progress_letter || null,
            attendance_status: resolvedReport.attendance_status,
            absence_reason: resolvedReport.absence_reason,
            class_participation: resolvedReport.class_participation,
            classroom_behavior: resolvedReport.classroom_behavior,
            contact_notes: resolvedReport.contact_notes,
            class_notes: resolvedReport.class_notes,
            content: resolvedReport.content,
            external_link: resolvedReport.external_link,

            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updatePayload)
            .eq('id', reportId)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to resolve conflict: ${updateError.message}`)

        return new OccurrenceReport(updated)
    }

    /**
     * Gets all reports for an enrollment with pagination
     */
    static async getReportsByEnrollment(
        enrollmentId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: OccurrenceReport[], count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        const { data, error, count } = await supabase
            .from('occurrence_reports')
            .select('*', { count: 'exact' })
            .eq('enrollment_id', enrollmentId)
            .order('created_at', { ascending: false })
            .range(from, to)

        if (error) throw new Error(error.message)

        return {
            data: data.map(dto => new OccurrenceReport(dto)),
            count: count || 0
        }
    }

    /**
     * Gets reports for specific occurrences
     * Useful for showing all student reports for a class
     */
    static async getReportsByOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('class_occurrence_id', occurrenceId)
            .order('created_at', { ascending: false })

        if (error) throw new Error(error.message)

        return data.map(dto => new OccurrenceReport(dto))
    }

    /**
     * Gets a single report by ID
     */
    static async getReportById(reportId: string): Promise<OccurrenceReport> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (error) throw new Error(error.message)

        return new OccurrenceReport(data)
    }

    /**
     * Deletes a report and reverts enrollment progress.
     */
    static async deleteReportAndRevertProgress(reportId: string): Promise<void> {
        // 1. Fetch report to get enrollment_id
        const { data: report, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('enrollment_id')
            .eq('id', reportId)
            .single()

        if (fetchError || !report) throw new Error(`Failed to fetch report for deletion: ${fetchError?.message}`)

        // 2. Delete report
        const { error: deleteError } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('id', reportId)

        if (deleteError) throw new Error(`Failed to delete report: ${deleteError.message}`)

        // 3. Recalculate progress
        await EnrollmentProgressService.recalculateEnrollmentProgress(report.enrollment_id)
    }

    /**
     * Deletes a report (use with caution)
     */
    static async deleteReport(reportId: string): Promise<void> {
        const { error } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('id', reportId)

        if (error) throw new Error(error.message)
    }

    /**
     * Bulk creates reports for all enrollments in a session occurrence
     * Useful when marking attendance or initializing reports
     */
    static async createReportsForOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        // Get the class session from occurrence
        const { data: occurrence, error: occError } = await supabase
            .from('class_occurrences')
            .select('class_session_id')
            .eq('id', occurrenceId)
            .single()

        if (occError) throw new Error(`Failed to fetch occurrence: ${occError.message}`)

        // Get all active enrollments for this session
        const { data: enrollments, error: enrollError } = await supabase
            .from('enrollments')
            .select('id')
            .eq('class_session_id', occurrence.class_session_id)
            .eq('status', 'active')

        if (enrollError) throw new Error(`Failed to fetch enrollments: ${enrollError.message}`)

        const reports: OccurrenceReport[] = []

        // Create report for each enrollment
        for (const enrollment of enrollments) {
            const report = await this.getOrCreateReport(enrollment.id, occurrenceId)
            reports.push(report)
        }

        return reports
    }

    /**
     * Gets reports with occurrence and enrollment details
     * Includes joined data for display purposes
     */
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

        return data
    }

    /**
     * Get pending reports (active enrollments, conducted class, incomplete report)
     */
    static async getPendingReports(): Promise<any[]> {
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
        const dateStr = thirtyDaysAgo.toISOString().split('T')[0]

        // We'll fetch occurrences first
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

        // Fetch existing reports with attendance and content check fields
        const { data: reports } = await supabase
            .from('occurrence_reports')
            .select('id, enrollment_id, class_occurrence_id, is_completed, attendance_status, content, lesson_id')
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

                // Logic Refinement: Report is ONLY considered pending if:
                // 1. Student is PRESENT
                // 2. Progress is NOT done (not manually completed AND no chapter range filled like 'A-B')
                // 3. AND Learning content is EMPTY
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
                            isMissing: true // By this strict logic, it represents a totally empty entry for an attended class
                        })
                    }
                }
                // Entirely missing reports or other attendance statuses are explicitly skipped
                // to focus on completing records for attended students.
            }
        }

        return pending.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    }

    /**
     * Gets reports for a specific lesson from other students (Peer Reports)
     */
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

    /**
     * Gets all historical reports for a specific student across all courses
     */
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

        // First get all enrollment IDs for this student
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

    /**
     * Gets all incomplete reports globally (across all students/courses)
     * "Incomplete" means present but missing content or lesson.
     * Restricted to today or past dates.
     */
    static async getGlobalIncompleteReports(): Promise<any[]> {
        const now = new Date()
        // Format as YYYY-MM-DD for simple string comparison in database if possible, 
        // but since occurrences store specific times or just dates, we should be careful.
        // Assuming occurrence_date is a DATE or TIMESTAMP column.

        // We want all reports where attendance = 'present'
        // AND (content is empty OR lesson_id is null)
        // AND occurrence_date <= today

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
                enrollments!inner (
                    id,
                    student_id,
                    course_id,
                    students!inner (
                        id,
                        name
                    )
                ),
                class_occurrence:class_occurrences!inner (
                    id,
                    occurrence_date,
                    original_start_time,
                    actual_start_time,
                    class_session:class_sessions!inner (
                        id,
                        name,
                        classroom:classrooms (
                            id,
                            name
                        )
                    )
                )
            `)
            .eq('attendance_status', 'present')
            //.or('content.is.null,content.eq.,lesson_id.is.null') // OR logic is tricky mixed with ANDs in Supabase if not careful with syntax
            // simpler to fetch 'present' and filter in JS if the dataset isn't massive.
            // But let's try to filter date in DB at least to reduce size.
            .lte('class_occurrence.occurrence_date', now.toISOString())
            .order('class_occurrence(occurrence_date)', { ascending: false })

        if (error) throw new Error(`Failed to fetch incomplete reports: ${error.message}`)

        // Refine filter in JS for the OR condition (missing content OR missing lesson)
        // Supabase .or() usually requires the whole query to be structured around it or using filter()

        return (data || [])
            .filter(r => {
                const hasContent = r.content && r.content.trim().length > 0
                const hasLesson = !!r.lesson_id

                // If both present, it's complete.
                if (hasContent && hasLesson) return false

                // Double check date (redundant but safe)
                const occ = Array.isArray(r.class_occurrence) ? r.class_occurrence[0] : r.class_occurrence
                if (!occ) return false
                // const occDate = new Date(occ.occurrence_date) // Unused variable

                return true
            })
            .map(r => {
                // Supabase joins can be arrays or objects depending on the relationship type inferred
                const enrollment = Array.isArray(r.enrollments) ? r.enrollments[0] : r.enrollments
                const student = Array.isArray(enrollment?.students) ? enrollment.students[0] : enrollment?.students

                const occ = Array.isArray(r.class_occurrence) ? r.class_occurrence[0] : r.class_occurrence
                const session = Array.isArray(occ?.class_session) ? occ.class_session[0] : occ?.class_session
                const classroom = Array.isArray(session?.classroom) ? session.classroom[0] : session?.classroom

                return {
                    id: r.id,
                    reportId: r.id,
                    enrollmentId: r.enrollment_id,
                    studentName: student?.name || 'Unknown',
                    fullStudent: student,
                    date: occ?.occurrence_date,
                    startTime: occ?.actual_start_time || occ?.original_start_time,
                    className: session?.name || 'Unknown Class',
                    classroomName: classroom?.name,
                    missingContent: !r.content || r.content.trim().length === 0,
                    missingLesson: !r.lesson_id,
                    version: r.version,
                    occurrenceId: r.class_occurrence_id,
                    courseId: enrollment?.course_id,
                    // Add fields needed for ReportEditor
                    content: r.content,
                    lessonId: r.lesson_id,
                    isCompleted: r.is_completed,
                    attendanceStatus: r.attendance_status
                }
            })
    }
}
