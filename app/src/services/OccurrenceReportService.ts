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
    static async getOrCreateReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        // Try to fetch existing report
        const { data: existing, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', occurrenceId)
            .maybeSingle()

        if (fetchError) throw new Error(`Failed to fetch report: ${fetchError.message}`)

        if (existing) {
            return new OccurrenceReport(existing)
        }

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

        // 2. Create new report if doesn't exist
        const newReport: Partial<OccurrenceReportDTO> = {
            enrollment_id: enrollmentId,
            class_occurrence_id: occurrenceId,
            content: '',
            version: 1,
            attendance_status: (isHoliday || isSuspended) ? 'absent' : 'present',
            absence_reason: isSuspended ? 'suspension' : (isHoliday ? 'holiday' : undefined),
            is_completed: (isHoliday || isSuspended) ? false : true
        }

        const { data: created, error: createError } = await supabase
            .from('occurrence_reports')
            .insert(newReport)
            .select()
            .single()

        if (createError) throw new Error(`Failed to create report: ${createError.message}`)

        return new OccurrenceReport(created)
    }

    /**
     * Saves a report with optimistic locking (version check).
     * Returns conflict status if version mismatch detected.
     * Also handles automatic progress tracking based on lesson completion.
     * 
     * @param reportId - The report ID
     * @param content - Learning report content
     * @param currentVersion - Client's current version
     * @param userId - User making the edit (optional)
     * @param detailedData - All detailed report fields
     * @returns Save result with conflict status
     */
    static async saveReport(
        reportId: string,
        content: string,
        currentVersion: number,
        userId?: string,
        detailedData?: {
            lessonId?: string
            isCompleted?: boolean
            progressLetter?: string
            attendanceStatus?: 'present' | 'absent'
            absenceReason?: string
            classParticipation?: number
            classroomBehavior?: number
            contactNotes?: string
            classNotes?: string
            externalLink?: string
        }
    ): Promise<SaveReportResult> {
        // Fetch current server version
        const { data: serverReport, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('version, content, enrollment_id, lesson_id')
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
                message: 'Conflict detected: Report was modified by another user'
            }
        }

        // No conflict - proceed with save
        const newVersion = currentVersion + 1

        const updateData: any = {
            content,
            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }

        // Add detailed fields if provided
        if (detailedData) {
            // Apply business rules
            let isCompleted = detailedData.isCompleted ?? true
            let progressLetter = detailedData.progressLetter

            // Rule: Absent → force incomplete
            if (detailedData.attendanceStatus === 'absent') {
                isCompleted = false
            }

            // Rule: Completed → clear progress letter
            if (isCompleted) {
                progressLetter = undefined
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
            
            console.log(`✅ Enrollment ${enrollmentId} auto-completed (last lesson finished)`)
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
                        is_completed: false
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
     * @param resolvedContent - The content after manual resolution
     * @param userId - User resolving the conflict
     * @returns Updated report
     */
    static async resolveConflict(
        reportId: string,
        resolvedContent: string,
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

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update({
                content: resolvedContent,
                version: newVersion,
                last_edited_by: userId,
                last_edited_at: new Date().toISOString()
            })
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
                        students (first_name, last_name, english_name)
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

        // Fetch existing reports
        const { data: reports } = await supabase
            .from('occurrence_reports')
            .select('id, enrollment_id, class_occurrence_id, is_completed')
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

                // If no report OR report is not completed
                if (!report || report.is_completed === false) {
                    pending.push({
                        id: report?.id || `missing_${key}`,
                        studentName: enr.students?.english_name || enr.students?.first_name || 'Unknown',
                        date: occ.occurrence_date,
                        className: session.name,
                        classroom: session.classrooms?.name,
                        occurrenceId: occ.id,
                        enrollmentId: enr.id,
                        isMissing: !report
                    })
                }
            }
        }
        
        return pending.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    }
}
