export interface CourseDTO {
  id?: string
  subject: string
  stage: string
  description?: string
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

  constructor(data: LessonDTO) {
    this.id = data.id
    this.courseId = data.course_id
    this.title = data.title
    this.sequence = data.sequence
  }
}

export class Course {
  id?: string
  subject: string
  stage: string
  description?: string
  lessons: Lesson[] = []

  constructor(data: CourseDTO) {
    this.id = data.id
    this.subject = data.subject
    this.stage = data.stage
    this.description = data.description
  }

  get displayName(): string {
    return `${this.subject} ${this.stage}`
  }

  addLesson(lesson: Lesson) {
    this.lessons.push(lesson)
    this.sortLessons()
  }

  sortLessons() {
    this.lessons.sort((a, b) => a.sequence - b.sequence)
  }
}
