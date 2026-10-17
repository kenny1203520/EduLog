type Translate = (key: string) => string

const ABSENCE_REASON_CODES = new Set([
    'busy_with_schoolwork', 'school_event', 'family_matter', 'sick_or_injured',
    'reason_not_provided', 'travel_abroad', 'holiday', 'family_ceremony',
    'school_activity', 'suspension', 'other'
])

// Older versions saved translated labels instead of stable reason codes.
const LEGACY_ABSENCE_REASON_CODES: Record<string, string> = {
    '課業繁忙': 'busy_with_schoolwork',
    'Busy with Schoolwork': 'busy_with_schoolwork',
    '校慶/運動會/畢業典禮': 'school_event',
    'School Event/Graduation': 'school_event',
    '家裡有事': 'family_matter',
    'Family Matter': 'family_matter',
    '生病/受傷': 'sick_or_injured',
    '生病／受傷': 'sick_or_injured',
    'Sick/Injured': 'sick_or_injured',
    '未告知原因': 'reason_not_provided',
    'Reason Not Provided': 'reason_not_provided',
    '出國': 'travel_abroad',
    'Travel Abroad': 'travel_abroad',
    '休假日': 'holiday',
    'Holiday': 'holiday',
    '喜慶/喪假': 'family_ceremony',
    'Family Ceremony': 'family_ceremony',
    '學校活動': 'school_activity',
    'School Activity': 'school_activity',
    '停課/停學': 'suspension',
    'Suspension': 'suspension',
    '其他原因': 'other',
    'Other Reason': 'other'
}

/** Converts historical localized values to stable codes and leaves custom text untouched. */
export function normalizeAbsenceReasonCode(reason: string | null | undefined): string {
    const normalized = reason?.trim() || ''
    if (ABSENCE_REASON_CODES.has(normalized)) return normalized
    return LEGACY_ABSENCE_REASON_CODES[normalized] || normalized
}

/** Localizes known reason codes without passing user or legacy text to vue-i18n. */
export function absenceReasonLabel(reason: string | null | undefined, t: Translate): string | null {
    const normalized = normalizeAbsenceReasonCode(reason)
    if (!normalized) return null
    if (!ABSENCE_REASON_CODES.has(normalized)) return normalized
    return t(`report.editor.absence_reasons.${normalized}`)
}
