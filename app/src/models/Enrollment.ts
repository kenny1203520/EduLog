import { DateUtils } from '@/utils/dateUtils'
import type { ClassSessionScheduleRuleDTO, ScheduleMode, SessionType } from './ClassSession'
export interface EnrollmentDTO {
    id?: string
    student_id: string
    course_id: string
    classroom_id?: string | null
    class_session_id?: string | null
    status: 'regular' | 'completed' | 'dropped' | 'trial'
    start_date?: string
    time_zone?: string
    lesson_number?: number
    external_link?: string
    koding_admission_id?: string
    created_at?: string
    updated_at?: string
    
    // Expanded relations
    courses?: {
        subject: string
        stage: string
        display_name?: string
        lessons?: Array<unknown>
    }
    classrooms?: {
        name: string
    }
    class_sessions?: {
        name: string
        day_of_week?: number
        start_time?: string
        end_time?: string
        time_zone?: string
        session_type?: SessionType
        schedule_mode?: ScheduleMode
        class_session_schedule_rules?: ClassSessionScheduleRuleDTO[]
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
    classroomId?: string | null
    classSessionId?: string | null
    status: string
    startDate?: string
    timeZone: string
    lessonNumber?: number
    externalLink?: string
    kodingAdmissionId?: string
    
    // Display helpers
    courseSubject: string = ''
    courseStage: string = ''
    courseDisplayName?: string
    classroomName: string = ''
    classSessionName: string = ''
    classSessionDayOfWeek?: number
    classSessionStartTime?: string
    classSessionEndTime?: string
    classSessionTimeZone: string = ''
    classSessionType: SessionType = 'regular'
    classSessionScheduleMode: ScheduleMode = 'weekly'
    classSessionScheduleRules: ClassSessionScheduleRuleDTO[] = []
    studentName?: string
    studentEmail?: string
    lessonCount: number = 0

    constructor(data: EnrollmentDTO) {
        this.id = data.id
        this.studentId = data.student_id
        this.courseId = data.course_id
        this.classroomId = data.classroom_id
        this.classSessionId = data.class_session_id
        this.status = data.status || 'regular'
        this.startDate = data.start_date
        this.timeZone = DateUtils.isValidTimeZone(data.time_zone) ? data.time_zone : DateUtils.getDefaultTimeZone()
        this.lessonNumber = data.lesson_number
        this.externalLink = data.external_link
        this.kodingAdmissionId = data.koding_admission_id
        
        if (data.courses) {
            this.courseSubject = data.courses.subject
            this.courseStage = data.courses.stage
            this.courseDisplayName = data.courses.display_name
            this.lessonCount = Array.isArray(data.courses.lessons) ? data.courses.lessons.length : 0
        }
        if (data.classrooms) {
            this.classroomName = data.classrooms.name
        }
        if (data.class_sessions) {
            this.classSessionName = data.class_sessions.name
            this.classSessionDayOfWeek = data.class_sessions.day_of_week
            this.classSessionStartTime = data.class_sessions.start_time
            this.classSessionEndTime = data.class_sessions.end_time
            this.classSessionTimeZone = DateUtils.isValidTimeZone(data.class_sessions.time_zone) ? data.class_sessions.time_zone : DateUtils.getDefaultTimeZone()
            this.classSessionType = data.class_sessions.session_type || 'regular'
            this.classSessionScheduleMode = data.class_sessions.schedule_mode || 'weekly'
            this.classSessionScheduleRules = data.class_sessions.class_session_schedule_rules || []
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
        return DateUtils.displayDate(this.startDate, undefined, this.timeZone)
    }

    get formattedSchedule(): string {
        if (this.classSessionScheduleRules.length > 0) {
            return this.classSessionScheduleRules.map(rule => {
                const time = `${rule.start_time.slice(0, 5)}-${rule.end_time.slice(0, 5)}`
                if (rule.schedule_kind === 'weekly') {
                    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                    return `${days[rule.day_of_week ?? 0]} ${time}`
                }
                if (rule.schedule_kind === 'monthly') return `Day ${rule.day_of_month} ${time}`
                return `${rule.occurrence_date} ${time}`
            }).join(', ')
        }
        if (this.classSessionDayOfWeek === undefined || !this.classSessionStartTime) return ''
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
        const dayName = days[this.classSessionDayOfWeek]
        const time = this.classSessionStartTime.slice(0, 5) // HH:MM
        return `${dayName} ${time}`
    }

    get classSessionDayKey(): string {
        if (this.classSessionDayOfWeek === undefined) return ''
        const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
        return days[this.classSessionDayOfWeek]
    }
}
