export interface EnrollmentDTO {
    id?: string
    student_id: string
    course_id: string
    classroom_id?: string
    class_session_id?: string
    status: 'active' | 'completed' | 'dropped'
    created_at?: string
    updated_at?: string
    
    // Expanded relations
    courses?: {
        subject: string
        stage: string
    }
    classrooms?: {
        name: string
    }
    class_sessions?: {
        name: string
    }
}

export class Enrollment {
    id?: string
    studentId: string
    courseId: string
    classroomId?: string
    classSessionId?: string
    status: string
    
    // Display helpers
    courseSubject: string = ''
    courseStage: string = ''
    classroomName: string = ''
    classSessionName: string = ''

    constructor(data: EnrollmentDTO) {
        this.id = data.id
        this.studentId = data.student_id
        this.courseId = data.course_id
        this.classroomId = data.classroom_id
        this.classSessionId = data.class_session_id
        this.status = data.status || 'active'
        
        if (data.courses) {
            this.courseSubject = data.courses.subject
            this.courseStage = data.courses.stage
        }
        if (data.classrooms) {
            this.classroomName = data.classrooms.name
        }
        if (data.class_sessions) {
            this.classSessionName = data.class_sessions.name
        }
    }
    
    get displayName(): string {
        return `${this.courseSubject} - ${this.courseStage}`
    }
}
