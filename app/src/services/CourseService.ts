import { supabase } from '@/lib/supabase'
import { Course, type CourseDTO, Lesson, type LessonDTO } from '@/models/Course'
import { Classroom, type ClassroomDTO, type ClassroomScheduleDTO, type ClassSessionDTO } from '@/models/Classroom'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'

export interface LessonReportDTO {
    id?: string
    enrollment_id: string
    lesson_id: string
    content: string
    version: number
    updated_at?: string
}

export class CourseService {
  // --- Class Sessions ---
   static async getClassSessions(page: number = 1, perPage: number = 100): Promise<{ data: ClassSessionDTO[], count: number }> {
      const from = (page - 1) * perPage
      const to = from + perPage - 1

      const { data, error, count } = await supabase
        .from('class_sessions')
        .select('*', { count: 'exact' })
        .range(from, to)

      if (error) throw new Error(error.message)
      return { data: data as ClassSessionDTO[], count: count || 0 }
   }

   static async createClassSession(session: Partial<ClassSessionDTO>): Promise<ClassSessionDTO> {
      const { data, error } = await supabase.from('class_sessions').insert(session).select().single()
      if (error) throw new Error(error.message)
      return data
   }

   static async deleteClassSession(id: string): Promise<void> {
      const { error } = await supabase.from('class_sessions').delete().eq('id', id)
      if (error) throw new Error(error.message)
   }

  // --- Lesson Reports ---
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
      // We expect enrollment_id and lesson_id to be present.
      // If id is present, we update. If not, we insert (or upsert on unique constraint).
      
      // For conflict resolution, we should ideally check version.
      // But for simple auto-save, we can use upsert.
      
      const { data, error } = await supabase
        .from('lesson_reports')
        .upsert(report, { onConflict: 'enrollment_id, lesson_id' })
        .select()
        .single()
        
      if (error) throw new Error(error.message)
      return data
  }

  // --- Enrollments ---
  static async getStudentEnrollments(studentId: string): Promise<Enrollment[]> {
      const { data, error } = await supabase
        .from('enrollments')
        .select(`
            *,
            courses (subject, stage),
            classrooms (name),
            class_sessions (name)
        `)
        .eq('student_id', studentId)
      
      if (error) throw new Error(error.message)
      
      return data.map((d: any) => new Enrollment(d))
  }

  static async getEnrollmentById(id: string): Promise<Enrollment | null> {
      const { data, error } = await supabase
        .from('enrollments')
        .select(`
            *,
            courses (subject, stage),
            classrooms (name),
            class_sessions (name)
        `)
        .eq('id', id)
        .maybeSingle()
      
      if (error) throw new Error(error.message)
      if (!data) return null
      return new Enrollment(data)
  }

  static async enrollStudent(enrollment: Partial<EnrollmentDTO>): Promise<Enrollment> {
      const { data, error } = await supabase.from('enrollments').insert(enrollment).select().single()
      if (error) throw new Error(error.message)
      return new Enrollment(data)
  }

  static async deleteEnrollment(id: string): Promise<void> {
      const { error } = await supabase.from('enrollments').delete().eq('id', id)
      if (error) throw new Error(error.message)
  }

  // --- Courses ---
  static async getCourses(page: number = 1, perPage: number = 100): Promise<{ data: Course[], count: number }> {
    const from = (page - 1) * perPage
    const to = from + perPage - 1

    const { data, error, count } = await supabase
      .from('courses')
      .select(`
        *,
        lessons (*)
      `, { count: 'exact' })
      .order('subject', { ascending: true })
      .order('stage', { ascending: true })
      .range(from, to)

    if (error) throw new Error(error.message)

    const courses = data.map((d: any) => {
      const course = new Course(d)
      if (d.lessons) {
        // Sort lessons by sequence in JS if DB sort is not guaranteed or for safety
        const sortedLessons = d.lessons.sort((a: LessonDTO, b: LessonDTO) => a.sequence - b.sequence)
        sortedLessons.forEach((l: LessonDTO) => course.addLesson(new Lesson(l)))
      }
      return course
    })
    return { data: courses, count: count || 0 }
  }

  static async createCourse(course: Partial<CourseDTO>): Promise<Course> {
    const { data, error } = await supabase.from('courses').insert(course).select().single()
    if (error) throw new Error(error.message)
    return new Course(data)
  }
  
  static async updateCourse(id: string, updates: Partial<CourseDTO>): Promise<Course> {
      const { data, error } = await supabase.from('courses').update(updates).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return new Course(data)
  }

  static async deleteCourse(id: string): Promise<void> {
    const { error } = await supabase.from('courses').delete().eq('id', id)
    if (error) throw new Error(error.message)
  }

  // --- Lessons ---
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

  // --- Classrooms ---
  static async getClassrooms(page: number = 1, perPage: number = 100): Promise<{ data: Classroom[], count: number }> {
      const from = (page - 1) * perPage
      const to = from + perPage - 1

      const { data, error, count } = await supabase
        .from('classrooms')
        .select(`*, classroom_schedules (*)`, { count: 'exact' })
        .order('name')
        .range(from, to)
      
      if (error) throw new Error(error.message)
      
      const classrooms = data.map((d: any) => {
          const c = new Classroom(d)
          if (d.classroom_schedules) {
              d.classroom_schedules.forEach((s: ClassroomScheduleDTO) => c.addSchedule(s))
          }
          return c
      })
      return { data: classrooms, count: count || 0 }
  }

  static async createClassroom(classroom: Partial<ClassroomDTO>): Promise<Classroom> {
      const { data, error } = await supabase.from('classrooms').insert(classroom).select().single()
      if (error) throw new Error(error.message)
      return new Classroom(data)
  }

  static async updateClassroom(id: string, updates: Partial<ClassroomDTO>): Promise<Classroom> {
      const { data, error } = await supabase.from('classrooms').update(updates).eq('id', id).select().single()
      if (error) throw new Error(error.message)
      return new Classroom(data)
  }

  static async deleteClassroom(id: string): Promise<void> {
      const { error } = await supabase.from('classrooms').delete().eq('id', id)
      if (error) throw new Error(error.message)
  }

  // --- Schedules ---
    static async createSchedule(schedule: Partial<ClassroomScheduleDTO>): Promise<ClassroomScheduleDTO> {
        const { data, error } = await supabase.from('classroom_schedules').insert(schedule).select().single()
        if (error) throw new Error(error.message)
        return data as ClassroomScheduleDTO
    }

    static async deleteSchedule(id: string): Promise<void> {
        const { error } = await supabase.from('classroom_schedules').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }
}
