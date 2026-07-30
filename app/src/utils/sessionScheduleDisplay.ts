import { ClassSessionFactory, type ClassSessionDTO } from '@/models/ClassSession'

export interface SessionScheduleDisplayItem {
    key: string
    text: string
}

type Translate = (key: string, named?: Record<string, unknown>) => string

export function buildSessionScheduleDisplayItems(
    session: ClassSessionDTO,
    translate: Translate,
    getDayLabel: (day: number) => string
): SessionScheduleDisplayItem[] {
    const model = ClassSessionFactory.create(session)
    if (model.isDraft) {
        return [{ key: 'draft', text: translate('classroom.schedule_draft') }]
    }

    return model.scheduleRules.map((rule, index) => {
        const time = `${rule.start_time.slice(0, 5)}-${rule.end_time.slice(0, 5)}`
        let text: string

        if (rule.schedule_kind === 'weekly') {
            text = `${getDayLabel(rule.day_of_week ?? 0)} ${time}`
        } else if (rule.schedule_kind === 'monthly') {
            text = translate('classroom.monthly_day_summary', { day: rule.day_of_month, time })
        } else {
            text = `${rule.occurrence_date} ${time}`
        }

        return {
            key: `${rule.schedule_kind}-${rule.day_of_week ?? rule.day_of_month ?? rule.occurrence_date ?? index}-${index}`,
            text
        }
    })
}
