import { DateUtils } from '@/utils/dateUtils'

export type SessionType = 'regular' | 'camp'
export type ScheduleMode = 'weekly' | 'monthly' | 'specific_dates'

export interface ClassSessionScheduleRuleDTO {
    id?: string
    class_session_id?: string
    schedule_kind: ScheduleMode
    day_of_week?: number | null
    day_of_month?: number | null
    occurrence_date?: string | null
    start_time: string
    end_time: string
    created_at?: string
    updated_at?: string
}

export interface ClassSessionDTO {
    id?: string
    name: string
    classroom_id?: string | null
    course_ids: string[]
    day_of_week?: number | null
    start_time?: string | null
    end_time?: string | null
    time_zone?: string
    capacity: number
    lesson_number?: number
    user_id?: string
    start_date?: string | null
    end_date?: string | null
    session_type?: SessionType
    schedule_mode?: ScheduleMode
    schedule_rules?: ClassSessionScheduleRuleDTO[]
    class_session_schedule_rules?: ClassSessionScheduleRuleDTO[]
    created_at?: string
    updated_at?: string
    external_link?: string
}

export interface PlannedClassOccurrence {
    occurrenceDate: string
    startTime: string
    endTime: string
}

function normalizeTime(value: string | null | undefined): string {
    return value?.slice(0, 8) || ''
}

function compareDates(left: string, right: string): number {
    return left.localeCompare(right)
}

export abstract class ClassSession {
    readonly id?: string
    readonly name: string
    readonly classroomId?: string | null
    readonly courseIds: string[]
    readonly capacity: number
    readonly lessonNumber?: number
    readonly timeZone: string
    readonly startDate?: string | null
    readonly endDate?: string | null
    readonly externalLink?: string
    readonly scheduleMode: ScheduleMode
    readonly scheduleRules: ClassSessionScheduleRuleDTO[]
    abstract readonly sessionType: SessionType

    protected constructor(data: ClassSessionDTO) {
        this.id = data.id
        this.name = data.name
        this.classroomId = data.classroom_id
        this.courseIds = data.course_ids || []
        this.capacity = data.capacity ?? 10
        this.lessonNumber = data.lesson_number
        this.timeZone = DateUtils.isValidTimeZone(data.time_zone) ? data.time_zone : DateUtils.getDefaultTimeZone()
        this.startDate = data.start_date
        this.endDate = data.end_date
        this.externalLink = data.external_link
        this.scheduleMode = data.schedule_mode || (data.session_type === 'camp' ? 'specific_dates' : 'weekly')
        this.scheduleRules = this.normalizeRules(data)
    }

    private normalizeRules(data: ClassSessionDTO): ClassSessionScheduleRuleDTO[] {
        const rules = data.schedule_rules || data.class_session_schedule_rules || []
        if (rules.length > 0) {
            return rules.map(rule => ({
                ...rule,
                start_time: normalizeTime(rule.start_time),
                end_time: normalizeTime(rule.end_time)
            }))
        }

        if (data.day_of_week !== null && data.day_of_week !== undefined && data.start_time && data.end_time) {
            return [{
                schedule_kind: 'weekly',
                day_of_week: data.day_of_week,
                start_time: normalizeTime(data.start_time),
                end_time: normalizeTime(data.end_time)
            }]
        }

        return []
    }

    abstract get isDraft(): boolean

    validate(): string[] {
        const errors: string[] = []
        if (!this.name.trim()) errors.push('Session name is required')
        if (this.startDate && this.endDate && this.startDate > this.endDate) {
            errors.push('Start date must not be after end date')
        }

        const selectors = new Set<string>()
        for (const rule of this.scheduleRules) {
            if (rule.schedule_kind !== this.scheduleMode) errors.push('Schedule rule kind does not match schedule mode')
            if (!DateUtils.parseTimeParts(rule.start_time) || !DateUtils.parseTimeParts(rule.end_time)) {
                errors.push('Schedule rule has an invalid time')
            } else if (rule.start_time >= rule.end_time) {
                errors.push('Schedule end time must be later than start time')
            }

            const selector = rule.schedule_kind === 'weekly'
                ? `w:${rule.day_of_week}`
                : rule.schedule_kind === 'monthly'
                    ? `m:${rule.day_of_month}`
                    : `d:${rule.occurrence_date}`
            if (selectors.has(selector)) errors.push('A session can have at most one class per day')
            selectors.add(selector)
        }

        return [...new Set(errors)]
    }

    ruleForDate(dateString: string): ClassSessionScheduleRuleDTO | undefined {
        if (this.isDraft) return undefined
        if (this.startDate && compareDates(dateString, this.startDate) < 0) return undefined
        if (this.endDate && compareDates(dateString, this.endDate) > 0) return undefined

        const date = DateUtils.parseLocalDate(dateString)
        if (!date) return undefined
        return this.scheduleRules.find(rule => {
            if (rule.schedule_kind === 'weekly') return rule.day_of_week === date.getDay()
            if (rule.schedule_kind === 'monthly') return rule.day_of_month === date.getDate()
            return rule.occurrence_date === dateString
        })
    }

    isScheduledOn(dateString: string): boolean {
        return Boolean(this.ruleForDate(dateString))
    }

    plannedOccurrences(rangeStart: Date, rangeEnd: Date): PlannedClassOccurrence[] {
        if (this.isDraft) return []

        const requestedStart = DateUtils.formatLocalDate(rangeStart)
        const requestedEnd = DateUtils.formatLocalDate(rangeEnd)
        const effectiveStart = this.startDate && this.startDate > requestedStart ? this.startDate : requestedStart
        const effectiveEnd = this.endDate && this.endDate < requestedEnd ? this.endDate : requestedEnd
        if (effectiveStart > effectiveEnd) return []

        const occurrences: PlannedClassOccurrence[] = []
        if (this.scheduleMode === 'specific_dates') {
            for (const rule of this.scheduleRules) {
                if (!rule.occurrence_date || rule.occurrence_date < effectiveStart || rule.occurrence_date > effectiveEnd) continue
                occurrences.push({ occurrenceDate: rule.occurrence_date, startTime: rule.start_time, endTime: rule.end_time })
            }
        } else {
            let current = DateUtils.parseLocalDate(effectiveStart)
            const end = DateUtils.parseLocalDate(effectiveEnd)
            while (current && end && current <= end) {
                const dateString = DateUtils.formatLocalDate(current)
                const rule = this.ruleForDate(dateString)
                if (rule) {
                    occurrences.push({ occurrenceDate: dateString, startTime: rule.start_time, endTime: rule.end_time })
                }
                current = DateUtils.addDays(current, 1)
            }
        }

        return occurrences.sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate))
    }

    toDTO(): ClassSessionDTO {
        return {
            id: this.id,
            name: this.name,
            classroom_id: this.classroomId,
            course_ids: [...this.courseIds],
            capacity: this.capacity,
            lesson_number: this.lessonNumber,
            time_zone: this.timeZone,
            start_date: this.startDate,
            end_date: this.endDate,
            external_link: this.externalLink,
            session_type: this.sessionType,
            schedule_mode: this.scheduleMode,
            schedule_rules: this.scheduleRules.map(rule => ({ ...rule }))
        }
    }
}

export class RegularClassSession extends ClassSession {
    readonly sessionType = 'regular' as const

    constructor(data: ClassSessionDTO) {
        super(data)
    }

    get isDraft(): boolean {
        return !this.startDate || this.scheduleRules.length === 0
    }

    override validate(): string[] {
        const errors = super.validate()
        if (!this.startDate) errors.push('Regular sessions require a start date')
        if (this.scheduleRules.length === 0) errors.push('Regular sessions require at least one schedule rule')
        return [...new Set(errors)]
    }
}

export class CampSession extends ClassSession {
    readonly sessionType = 'camp' as const

    constructor(data: ClassSessionDTO) {
        super(data)
    }

    get isDraft(): boolean {
        return !this.startDate || !this.endDate || this.scheduleRules.length === 0
    }

    override validate(): string[] {
        const errors = super.validate()
        for (const rule of this.scheduleRules) {
            if (!rule.occurrence_date) {
                errors.push('Camp schedule rules require a date')
                continue
            }
            if (this.startDate && rule.occurrence_date < this.startDate) {
                errors.push(`Camp schedule date ${rule.occurrence_date} is before the start date`)
            }
            if (this.endDate && rule.occurrence_date > this.endDate) {
                errors.push(`Camp schedule date ${rule.occurrence_date} is after the end date`)
            }
        }
        return [...new Set(errors)]
    }
}

export class ClassSessionFactory {
    static create(data: ClassSessionDTO): ClassSession {
        return data.session_type === 'camp' || data.schedule_mode === 'specific_dates'
            ? new CampSession(data)
            : new RegularClassSession(data)
    }
}
