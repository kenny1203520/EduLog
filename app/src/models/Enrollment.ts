export interface EnrollmentDTO {
    id?: string
    student_id: string
    course_id: string
    classroom_id?: string
    class_session_id?: string
    status: 'active' | 'completed' | 'dropped'
    start_date?: string
    lesson_number?: number
    created_at?: string
    updated_at?: string
    
    // Expanded relations
    courses?: {
        subject: string
        stage: string
        display_name?: string
    }
    classrooms?: {
        name: string
    }
    class_sessions?: {
        name: string
    }
    students?: {
        name: string
        email: string
    }
}

export class Enrollment {
    id?: string
    studentId: string
    courseId: string
    classroomId?: string
    classSessionId?: string
    status: string
    startDate?: string
    lessonNumber?: number
    
    // Display helpers
    courseSubject: string = ''
    courseStage: string = ''
    courseDisplayName?: string
    classroomName: string = ''
    classSessionName: string = ''
    studentName?: string
    studentEmail?: string

    constructor(data: EnrollmentDTO) {
        this.id = data.id
        this.studentId = data.student_id
        this.courseId = data.course_id
        this.classroomId = data.classroom_id
        this.classSessionId = data.class_session_id
        this.status = data.status || 'active'
        this.startDate = data.start_date
        this.lessonNumber = data.lesson_number
        
        if (data.courses) {
            this.courseSubject = data.courses.subject
            this.courseStage = data.courses.stage
            this.courseDisplayName = data.courses.display_name
        }
        if (data.classrooms) {
            this.classroomName = data.classrooms.name
        }
        if (data.class_sessions) {
            this.classSessionName = data.class_sessions.name
        }
        if (data.students) {
            this.studentName = data.students.name
            this.studentEmail = data.students.email
        }
    }
    
    get displayName(): string {
        if (this.courseDisplayName) return this.courseDisplayName
        return `${this.courseSubject} - ${this.courseStage}`
    }

    get formattedStartDate(): string {
        if (!this.startDate) return '-'
        return new Date(this.startDate).toLocaleDateString()
    }
}
