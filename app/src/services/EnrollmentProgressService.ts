import { supabase } from '@/lib/supabase'
import { type Lesson } from '@/models/Course'

/**
 * Service for managing student enrollment progress based on lesson completion
 * Implements the complex logic for automatic progress tracking:
 * - Completed lesson → advance to next lesson
 * - Uncompleted lesson → stay at current lesson
 * - Next lesson already completed → skip to first uncompleted lesson
 */
export class EnrollmentProgressService {
    /**
     * Updates student progress after a report is saved
     * @param enrollmentId - The enrollment to update
     * @param completedLessonSequence - The sequence number of the lesson that was just taught
     * @param isCompleted - Whether the lesson was completed
     * @param allLessons - All lessons in the course (sorted by sequence)
     * @returns The new lesson_number to set
     */
    static async calculateNewProgress(
        enrollmentId: string,
        completedLessonSequence: number,
        isCompleted: boolean,
        allLessons: Lesson[]
    ): Promise<number> {
        // If lesson was not completed, stay at current lesson
        if (!isCompleted) {
            return completedLessonSequence
        }

        // Lesson was completed - find next lesson
        const nextLesson = allLessons.find(l => l.sequence === completedLessonSequence + 1)

        if (!nextLesson) {
            // No next lesson (completed last lesson in course)
            return completedLessonSequence
        }

        // Check if next lesson already has a report
        const nextLessonHasReport = await this.hasReportForLesson(enrollmentId, nextLesson.id!)

        if (!nextLessonHasReport) {
            // Next lesson not yet taught → advance to it
            return nextLesson.sequence
        }

        // Next lesson already has report → find first uncompleted lesson
        const firstUncompletedLesson = await this.findFirstUncompletedLesson(enrollmentId, allLessons)

        return firstUncompletedLesson?.sequence ?? completedLessonSequence
    }

    /**
     * Checks if an enrollment has a report for a specific lesson
     */
    private static async hasReportForLesson(
        enrollmentId: string,
        lessonId: string
    ): Promise<boolean> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select('id')
            .eq('enrollment_id', enrollmentId)
            .eq('lesson_id', lessonId)
            .limit(1)

        if (error) {
            console.error('Error checking lesson report:', error)
            return false
        }

        return data && data.length > 0
    }

    /**
     * Finds the first lesson that doesn't have a report yet
     * @returns The first uncompleted lesson, or null if all lessons are complete
     */
    private static async findFirstUncompletedLesson(
        enrollmentId: string,
        allLessons: Lesson[]
    ): Promise<Lesson | null> {
        // Get all lesson_ids that have reports
        const { data: reports, error } = await supabase
            .from('occurrence_reports')
            .select('lesson_id')
            .eq('enrollment_id', enrollmentId)
            .not('lesson_id', 'is', null)

        if (error) {
            console.error('Error fetching lesson reports:', error)
            return null
        }

        const completedLessonIds = new Set(reports?.map(r => r.lesson_id) || [])

        // Find first lesson not in completed set
        return allLessons.find(l => l.id && !completedLessonIds.has(l.id)) || null
    }

    /**
     * Updates an enrollment's lesson_number in the database
     */
    static async updateEnrollmentProgress(
        enrollmentId: string,
        newLessonNumber: number
    ): Promise<void> {
        const { error } = await supabase
            .from('enrollments')
            .update({ lesson_number: newLessonNumber })
            .eq('id', enrollmentId)

        if (error) {
            throw new Error(`Failed to update enrollment progress: ${error.message}`)
        }
    }

    /**
     * Gets the current progress and calculates what lesson should be next
     * @param enrollmentId - The enrollment ID
     * @param courseId - The course ID (to fetch lessons)
     * @returns Object with current and recommended next lesson
     */
    static async getProgressRecommendation(
        enrollmentId: string,
        courseId: string
    ): Promise<{
        currentLessonNumber: number
        recommendedLesson: Lesson | null
        allLessons: Lesson[]
    }> {
        // Fetch enrollment to get current progress
        const { data: enrollment, error: enrollError } = await supabase
            .from('enrollments')
            .select('lesson_number')
            .eq('id', enrollmentId)
            .single()

        if (enrollError) {
            throw new Error(`Failed to fetch enrollment: ${enrollError.message}`)
        }

        // Fetch all lessons for the course
        const { data: lessonsData, error: lessonsError } = await supabase
            .from('lessons')
            .select('*')
            .eq('course_id', courseId)
            .order('sequence', { ascending: true })

        if (lessonsError) {
            throw new Error(`Failed to fetch lessons: ${lessonsError.message}`)
        }

        const lessons = lessonsData.map(l => ({
            id: l.id,
            courseId: l.course_id,
            title: l.title,
            sequence: l.sequence,
            created_at: l.created_at,
            updated_at: l.updated_at
        }))

        const currentLessonNumber = enrollment.lesson_number || 1
        const recommendedLesson = lessons.find(l => l.sequence === currentLessonNumber) || lessons[0] || null

        return {
            currentLessonNumber,
            recommendedLesson,
            allLessons: lessons
        }
    }
}
