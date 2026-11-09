import { apiV1Client, type ApiEnvelope } from './ApiV1Client'
import type { CourseDTO, LessonDTO } from '@/models/Course'
import type { StudentDTO, StudentCapabilitiesDTO, StudentSchoolSummaryDTO } from '@/models/Student'
import type { EnrollmentDTO } from '@/models/Enrollment'
import type { ClassSessionDTO } from '@/models/ClassSession'
import type { TeacherDTO } from '@/services/teacher/TeacherService'

export interface PageListMeta {
  limit: number
  offset: number
  total: number
  sort: string
}

export interface PageListQuery {
  limit?: number
  offset?: number
  search?: string
  sort?: string
}

export const MAX_PAGE_SIZE = 100

export function normalizePageSize(value: number | undefined, fallback = MAX_PAGE_SIZE) {
  const candidate = Number.isFinite(value) ? Math.trunc(value as number) : fallback
  return Math.min(MAX_PAGE_SIZE, Math.max(1, candidate))
}

function normalizeOffset(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value as number)) : 0
}

export type CourseOverviewDTO = CourseDTO & { lessons?: LessonDTO[] }
export type StudentOverviewDTO = Pick<StudentDTO, 'id' | 'name' | 'notes' | 'notes_document' | 'external_link' | 'created_at' | 'updated_at'> & {
  current_school?: StudentSchoolSummaryDTO | null
}
export type StudentProfileDTO = Pick<StudentDTO, 'id' | 'name' | 'notes' | 'notes_document' | 'external_link' | 'created_at' | 'updated_at' | 'enrollments'> & {
  current_school?: StudentSchoolSummaryDTO | null
  capabilities: StudentCapabilitiesDTO
}
export type StudentPrivateDetailsDTO = { student: Pick<StudentDTO, 'id' | 'gov_id' | 'email' | 'phone' | 'residence_address' | 'mailing_address' | 'birthday'> }
export type StudentReportsDTO = { student: Pick<StudentDTO, 'id' | 'name'>; enrollments: EnrollmentDTO[] }
// Sensitive properties are optional for shared view-model compatibility only;
// the overview endpoint never requests or returns them.
export type TeacherOverviewDTO = Pick<TeacherDTO, 'id' | 'user_id' | 'name' | 'bio' | 'bio_document' | 'created_at' | 'updated_at'> & Partial<Pick<TeacherDTO, 'email' | 'phone'>>
export type TeachersOverviewDTO = { teachers: TeacherOverviewDTO[]; statistics: import('@/services/teacher/TeacherService').TeacherStatisticsDTO }
export type ClassSessionOverviewDTO = ClassSessionDTO & { teaching_id?: string; classrooms?: { id: string; name: string; color?: string | null } | null }
export interface ClassSessionWorkspaceDTO {
  session: Record<string, unknown> & { roster_date?: string | null; current_enrollments?: number }
  enrollments: EnrollmentDTO[]
  teachers: Array<Pick<TeacherDTO, 'id' | 'user_id' | 'name'>>
}
export interface UserPreferencesPageDTO {
  preferences: { id?: string; user_id?: string; time_zone?: string; editor_settings?: Record<string, unknown>; created_at?: string; updated_at?: string } | null
  visibility: Record<string, string[]>
}
export interface EnrollmentReportsPageDTO { enrollment: Record<string, unknown> | null; reports: Array<Record<string, unknown>>; count: number }
export interface DashboardPageDTO { pendingReportsScope: string; stats: { totalStudents: number; activeCourses: number; pendingReportsCount: number; pendingReportsScope: string }; pendingReports: Array<Record<string, unknown>>; occurrences: Array<Record<string, unknown>> }
export interface IncompleteReportPageDTO {
  id: string
  reportId: string
  enrollmentId: string
  occurrenceId: string
  sessionId: string
  classroomId: string | null
  studentName: string
  courseId: string | null
  className: string
  classroomName: string
  date: string
  timeZone: string | null
  startTime?: string | null
  endTime?: string | null
  content: string
  contentDocument?: Record<string, unknown> | null
  lessonId: string | null
  missingContent: boolean
  missingLesson: boolean
  missingProgress: boolean
  missingParticipation: boolean
  missingBehavior: boolean
  isIncomplete: true
  isMissing: false
  isCompleted: boolean | null
  progressLetter: string | null
  attendanceStatus: string
  absenceReason: string | null
  classParticipation: number | null
  classroomBehavior: number | null
  contactNotes: string | null
  classNotes: string | null
  externalLink: string | null
  version: number | null
  updatedAt: string | null
}
export interface HolidayOverviewPageDTO { id: string; start_date: string; end_date: string; [key: string]: unknown }
export interface ClassroomOverviewPageDTO {
  classrooms: Array<Record<string, unknown>>
  count: number
  classroomTotal?: number
  visibleClassroomCount?: number
  hiddenClassroomCount?: number
  hiddenClassroomIds: string[]
  hiddenSessionIds: string[]
  classSessions: ClassSessionOverviewDTO[]
  sessionCount: number
  sessionTotal?: number
  visibleSessionCount?: number
  hiddenSessionCount?: number
}

function queryString(query: PageListQuery = {}) {
  const params = new URLSearchParams()
  if (query.limit !== undefined) params.set('limit', String(normalizePageSize(query.limit)))
  if (query.offset !== undefined) params.set('offset', String(normalizeOffset(query.offset)))
  if (query.search) params.set('search', query.search)
  if (query.sort) params.set('sort', query.sort)
  const serialized = params.toString()
  return serialized ? `?${serialized}` : ''
}

export class PageApiService {
  static getCoursesOverview(query: PageListQuery = {}) {
    return apiV1Client.get<CourseOverviewDTO[]>(`/pages/courses/overview${queryString(query)}`)
  }

  static getStudentsOverview(query: PageListQuery = {}) {
    return apiV1Client.get<StudentOverviewDTO[]>(`/pages/students/overview${queryString(query)}`)
  }

  static getStudentProfile(studentId: string) {
    return apiV1Client.get<StudentProfileDTO>(`/pages/students/${encodeURIComponent(studentId)}/profile`)
  }

  static getStudentPrivateDetails(studentId: string) {
    return apiV1Client.get<StudentPrivateDetailsDTO>(`/pages/students/${encodeURIComponent(studentId)}/private-details`)
  }

  static getStudentReports(studentId: string, query: Pick<PageListQuery, 'limit' | 'offset' | 'sort'> = {}) {
    return apiV1Client.get<StudentReportsDTO>(`/pages/students/${encodeURIComponent(studentId)}/reports${queryString(query)}`)
  }

  static getTeachersOverview(query: PageListQuery = {}) {
    return apiV1Client.get<TeachersOverviewDTO>(`/pages/teachers/overview${queryString(query)}`)
  }

  static getTeacherPrivateDetails(teacherId: string) {
    return apiV1Client.get<{ teacher: TeacherDTO; credentials: TeacherDTO['teacher_credentials'] }>(`/pages/teachers/${encodeURIComponent(teacherId)}/private-details`)
  }

  static getClassSessionWorkspace(sessionId: string, occurrenceDate?: string) {
    const params = new URLSearchParams()
    if (occurrenceDate) params.set('occurrence_date', occurrenceDate)
    const query = params.toString()
    return apiV1Client.get<ClassSessionWorkspaceDTO>(`/pages/class-sessions/${encodeURIComponent(sessionId)}/workspace${query ? `?${query}` : ''}`)
  }

  static getUserPreferences() {
    return apiV1Client.get<UserPreferencesPageDTO>('/pages/me/preferences')
  }

  static getEnrollmentReports(enrollmentId: string, query: { limit: number; offset: number; sort: string }) {
    const params = new URLSearchParams({ limit: String(normalizePageSize(query.limit)), offset: String(normalizeOffset(query.offset)), sort: query.sort })
    return apiV1Client.get<EnrollmentReportsPageDTO>(`/pages/enrollments/${encodeURIComponent(enrollmentId)}/reports?${params}`)
  }

  static getClassroomsOverview(query: PageListQuery & { visibility?: string; session_limit?: number; session_offset?: number; classroom_id?: string }) {
    const params = new URLSearchParams(queryString(query).replace(/^\?/, ''))
    if (query.visibility) params.set('visibility', query.visibility)
    if (query.session_limit !== undefined) params.set('session_limit', String(normalizePageSize(query.session_limit)))
    if (query.session_offset !== undefined) params.set('session_offset', String(normalizeOffset(query.session_offset)))
    if (query.classroom_id) params.set('classroom_id', query.classroom_id)
    return apiV1Client.get<ClassroomOverviewPageDTO>(`/pages/classrooms/overview?${params}`)
  }

  static getDashboard(query: { start?: string; end?: string; cache?: RequestCache } = {}) {
    const params = new URLSearchParams()
    if (query.start) params.set('start', query.start)
    if (query.end) params.set('end', query.end)
    return apiV1Client.get<DashboardPageDTO>(`/pages/dashboard?${params}`, query.cache ? { cache: query.cache } : undefined)
  }

  static getIncompleteReports(query: { days_back: number; scope: 'all' | 'my_present' | 'my_notifications'; limit?: number; offset?: number; search?: string; sort?: 'date' | '-date' | 'updated_at' | '-updated_at'; cache?: RequestCache }) {
    const params = new URLSearchParams({
      days_back: String(query.days_back),
      scope: query.scope,
      limit: String(normalizePageSize(query.limit, 25)),
      offset: String(normalizeOffset(query.offset)),
      sort: query.sort ?? '-date',
    })
    if (query.search) params.set('search', query.search)
    return apiV1Client.get<IncompleteReportPageDTO[]>(`/pages/reports/incomplete?${params}`, query.cache ? { cache: query.cache } : undefined)
  }

  static getHolidaysOverview(query: { expand?: boolean; limit?: number; offset?: number; search?: string; sort?: string } = {}) {
    const params = new URLSearchParams({ expand: String(query.expand ?? true), limit: String(normalizePageSize(query.limit)), offset: String(normalizeOffset(query.offset)) })
    if (query.search) params.set('search', query.search)
    if (query.sort) params.set('sort', query.sort)
    return apiV1Client.get<HolidayOverviewPageDTO[]>(`/pages/holidays/overview?${params}`)
  }

  static async getPaginated<T>(request: Promise<ApiEnvelope<T[]>>) {
    const response = await request
    return { data: response.data ?? [], count: Number(response.meta?.total ?? response.data?.length ?? 0), meta: response.meta }
  }
}
