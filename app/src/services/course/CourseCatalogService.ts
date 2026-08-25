import { supabase } from '@/lib/supabase'
import { Course, type CourseDTO, Lesson, type LessonDTO } from '@/models/Course'
import { createTextEditorContent } from '@/components/common/text-editor/content'

export interface LessonReportDTO {
    id?: string
    enrollment_id: string
    lesson_id: string
    content: string
    version: number
    updated_at?: string
}

export class CourseCatalogService {
    static async getCourses(page: number = 1, perPage: number = 100): Promise<{ data: Course[], count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        const { data, error, count } = await supabase
            .from('courses')
            .select(`
        *,
        lessons (*)
      `, { count: 'exact' })
            .order('display_name', { ascending: true, nullsFirst: false })
            .order('subject', { ascending: true })
            .order('stage', { ascending: true })
            .range(from, to)

        if (error) throw new Error(error.message)

        const courses = (data || []).map((d: any) => {
            const course = new Course(d)
            if (d.lessons) {
                const sortedLessons = d.lessons.sort((a: LessonDTO, b: LessonDTO) => a.sequence - b.sequence)
                sortedLessons.forEach((l: LessonDTO) => course.addLesson(new Lesson(l)))
            }
            return course
        })
        return { data: courses, count: count || 0 }
    }

    static async createCourse(course: Partial<CourseDTO>): Promise<Course> {
        const { data, error } = await supabase.from('courses').insert(this.normalizeCourse(course)).select().single()
        if (error) throw new Error(error.message)
        return new Course(data)
    }

    static async updateCourse(id: string, updates: Partial<CourseDTO>): Promise<Course> {
        const { data, error } = await supabase.from('courses').update(this.normalizeCourse(updates)).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return new Course(data)
    }

    private static normalizeCourse(course: Partial<CourseDTO>): Partial<CourseDTO> {
        if (course.description_document || course.description !== undefined) {
            const description = createTextEditorContent(course.description_document || course.description || '')
            return { ...course, description: description.plainText, description_document: description.richText }
        }
        return course
    }

    static async deleteCourse(id: string): Promise<void> {
        const { error } = await supabase.from('courses').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async getLessonsByCourse(courseId: string): Promise<Lesson[]> {
        const { data, error } = await supabase
            .from('lessons')
            .select('id, course_id, title, sequence')
            .eq('course_id', courseId)
            .order('sequence', { ascending: true })

        if (error) throw new Error(error.message)
        return (data || []).map((d: any) => new Lesson(d))
    }

    static async createLesson(lesson: Partial<LessonDTO>): Promise<Lesson> {
        const { data, error } = await supabase.from('lessons').insert(lesson).select().single()
        if (error) throw new Error(error.message)
        return new Lesson(data)
    }

    static async updateLesson(id: string, updates: Partial<LessonDTO>): Promise<Lesson> {
        const { data, error } = await supabase.from('lessons').update(updates).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return new Lesson(data)
    }

    static async deleteLesson(id: string): Promise<void> {
        const { error } = await supabase.from('lessons').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async getLessonReport(enrollmentId: string, lessonId: string): Promise<LessonReportDTO | null> {
        const { data, error } = await supabase
            .from('lesson_reports')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .eq('lesson_id', lessonId)
            .maybeSingle()

        if (error) throw new Error(error.message)
        return data
    }

    static async upsertLessonReport(report: Partial<LessonReportDTO>): Promise<LessonReportDTO> {
        const { data, error } = await supabase
            .from('lesson_reports')
            .upsert(report, { onConflict: 'enrollment_id, lesson_id' })
            .select()
            .single()

        if (error) throw new Error(error.message)
        return data
    }
}
