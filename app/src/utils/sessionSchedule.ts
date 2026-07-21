import { ClassSessionFactory, type ClassSessionDTO } from '@/models/ClassSession'

type Translate = (key: string, params?: Record<string, unknown>) => string

export function formatClassSessionSchedule(
    session: ClassSessionDTO,
    locale: string,
    translate: Translate
): string {
    const model = ClassSessionFactory.create(session)
    if (model.isDraft) return translate('classroom.schedule_draft')

    return model.scheduleRules.map(rule => {
        const time = `${rule.start_time.slice(0, 5)}-${rule.end_time.slice(0, 5)}`
        if (rule.schedule_kind === 'weekly') {
            const anchor = new Date(2023, 0, 1 + (rule.day_of_week ?? 0))
            return `${anchor.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
        }
        if (rule.schedule_kind === 'monthly') {
            return translate('classroom.monthly_day_summary', { day: rule.day_of_month, time })
        }
        return `${rule.occurrence_date} ${time}`
    }).join('、')
}
export function formatClassSessionOption(
    session: ClassSessionDTO,
    locale: string,
    translate: Translate
): string {
    const schedule = formatClassSessionSchedule(session, locale, translate)
    return schedule ? `${session.name} · ${schedule}` : session.name
}
