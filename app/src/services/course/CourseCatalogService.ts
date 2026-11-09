import { Course, type CourseDTO, Lesson, type LessonDTO } from '@/models/Course'
import { createTextEditorContent } from '@/components/text-editor/content'
import { apiResourceClient } from '../api/ApiResourceClient'

function toCourse(dto: CourseDTO & { lessons?: LessonDTO[] }) {
    const course = new Course(dto)
    for (const lesson of [...(dto.lessons ?? [])].sort((a, b) => a.sequence - b.sequence)) course.addLesson(new Lesson(lesson))
    return course
}

export class CourseCatalogService {
    static async getCourses(page: number = 1, perPage: number = 100): Promise<{ data: Course[], count: number }> {
        const result = await apiResourceClient.list<CourseDTO & { lessons?: LessonDTO[] }>('courses', { page, perPage, sort: 'display_name' })
        const courses = (result.data || []).map(toCourse)
        return { data: courses, count: result.meta?.total ?? courses.length }
    }

    static async getCourseOptions(page: number = 1, perPage: number = 1000): Promise<{ data: Array<Pick<CourseDTO, 'id' | 'subject' | 'stage' | 'display_name'>>; count: number }> {
        const result = await apiResourceClient.list<CourseDTO>('courses', { page, perPage, sort: 'display_name' })
        return { data: (result.data || []).map(({ id, subject, stage, display_name }) => ({ id, subject, stage, display_name })), count: result.meta?.total ?? result.data?.length ?? 0 }
    }

    static async createCourse(course: Partial<CourseDTO>): Promise<Course> {
        return new Course((await apiResourceClient.create<CourseDTO>('courses', this.normalizeCourse(course))).data)
    }

    static async updateCourse(id: string, updates: Partial<CourseDTO>): Promise<Course> {
        return new Course((await apiResourceClient.update<CourseDTO>('courses', id, this.normalizeCourse(updates))).data)
    }

    private static normalizeCourse(course: Partial<CourseDTO>): Partial<CourseDTO> {
        if (course.description_document || course.description !== undefined) {
            const description = createTextEditorContent(course.description_document || course.description || '')
            return { ...course, description: description.plainText, description_document: description.richText }
        }
        return course
    }

    static async deleteCourse(id: string): Promise<void> {
        await apiResourceClient.remove('courses', id)
    }

    static async getLessonsByCourse(courseId: string): Promise<Lesson[]> {
        const result = await apiResourceClient.list<LessonDTO>('lessons', { perPage: 100, sort: 'sequence', courseId })
        return (result.data || []).filter((lesson) => lesson.course_id === courseId).map((dto: any) => new Lesson(dto))
    }

    static async createLesson(lesson: Partial<LessonDTO>): Promise<Lesson> {
        return new Lesson((await apiResourceClient.create<LessonDTO>('lessons', lesson)).data)
    }

    static async updateLesson(id: string, updates: Partial<LessonDTO>): Promise<Lesson> {
        return new Lesson((await apiResourceClient.update<LessonDTO>('lessons', id, updates)).data)
    }

    static async deleteLesson(id: string): Promise<void> {
        await apiResourceClient.remove('lessons', id)
    }

}
