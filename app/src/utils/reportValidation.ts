// OccurrenceReport validation utilities
export interface ReportValidationError {
    field: string
    message: string
}

/**
 * Validates report data according to business rules:
 * - If absent → must have absence_reason
 * - If incomplete → progress_letter is recommended
 */
export function validateReportData(data: {
    attendanceStatus?: 'present' | 'absent' | 'pending'
    absenceReason?: string
    isCompleted?: boolean
    progressLetter?: string
}): { isValid: boolean; errors: ReportValidationError[] } {
    const errors: ReportValidationError[] = []

    // Rule 1: Absent requires absence reason
    if (data.attendanceStatus === 'absent') {
        if (!data.absenceReason || data.absenceReason.trim() === '') {
            errors.push({
                field: 'absence_reason',
                message: '請假原因為必填'
            })
        }
    }

    // Rule 2: Incomplete should have progress letter (warning only)
    if (data.isCompleted === false && !data.progressLetter) {
        // This is a warning, not an error
        // Could add to warnings array if needed
    }

    return {
        isValid: errors.length === 0,
        errors
    }
}

/**
 * Applies business rules to report data:
 * - If completed → clear progress_letter
 */
export function applyBusinessRules(data: {
    attendanceStatus?: 'present' | 'absent' | 'pending'
    isCompleted?: boolean
    progressLetter?: string
}): {
    isCompleted: boolean
    progressLetter?: string
} {
    let isCompleted = data.isCompleted ?? true
    let progressLetter = data.progressLetter

    // Rule: Completed → clear progress letter
    if (isCompleted) {
        progressLetter = undefined
    }

    return { isCompleted, progressLetter }
}
