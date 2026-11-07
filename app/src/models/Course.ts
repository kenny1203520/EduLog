import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { createTextEditorContent } from '@/components/text-editor/content'

export interface CourseDTO {
  id?: string
  subject: string
  stage: string
  display_name?: string
  description?: string
  description_document?: RichTextDocumentV1 | null
  created_at?: string
  updated_at?: string
}

export interface LessonDTO {
  id?: string
  course_id: string
  title: string
  sequence: number
  created_at?: string
  updated_at?: string
}

export class Lesson {
  id?: string
  courseId: string
  title: string
  sequence: number
  created_at?: string
  updated_at?: string

  constructor(data: LessonDTO) {
    this.id = data.id
    this.courseId = data.course_id
    this.title = data.title
    this.sequence = data.sequence
    this.created_at = data.created_at
    this.updated_at = data.updated_at
  }
}

export class Course {
  id?: string
  subject: string
  stage: string
  displayNameValue?: string
  description?: string
  descriptionDocument: RichTextDocumentV1
  created_at?: string
  updated_at?: string
  lessons: Lesson[] = []

  constructor(data: CourseDTO) {
    this.id = data.id
    this.subject = data.subject
    this.stage = data.stage
    this.displayNameValue = data.display_name
    const description = createTextEditorContent(data.description_document || data.description || '')
    this.description = description.plainText
    this.descriptionDocument = description.richText
    this.created_at = data.created_at
    this.updated_at = data.updated_at
  }

  get displayName(): string {
    return this.displayNameValue || `${this.subject} ${this.stage}`
  }

  addLesson(lesson: Lesson) {
    this.lessons.push(lesson)
    this.sortLessons()
  }

  sortLessons() {
    this.lessons.sort((a, b) => a.sequence - b.sequence)
  }
}
