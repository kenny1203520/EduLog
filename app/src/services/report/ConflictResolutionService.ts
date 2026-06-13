import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

export interface ConflictInfo {
    hasConflict: boolean
    conflictingFields: string[]
    serverVersion: OccurrenceReportDTO
    clientVersion: OccurrenceReportDTO
    resolution: 'merge' | 'server' | 'client' | 'manual'
}

export interface MergeStrategy {
    strategy: 'last-write-wins' | 'client-priority' | 'server-priority' | 'field-merge'
}

/**
 * Service for detecting and resolving conflicts in concurrent report editing
 */
export class ConflictResolutionService {
    /**
     * Detect conflicts between two versions of a report
     */
    static detectConflict(
        serverVersion: OccurrenceReportDTO,
        clientVersion: OccurrenceReportDTO
    ): ConflictInfo {
        const conflictingFields = this.findConflictingFields(serverVersion, clientVersion)

        return {
            hasConflict: conflictingFields.length > 0,
            conflictingFields,
            serverVersion,
            clientVersion,
            resolution: conflictingFields.length > 0 ? 'manual' : 'merge'
        }
    }

    /**
     * Find fields that differ between two report versions
     */
    private static findConflictingFields(
        server: OccurrenceReportDTO,
        client: OccurrenceReportDTO
    ): string[] {
        const fieldsThatMatter = [
            'content',
            'attendance_status',
            'is_completed',
            'progress_letter',
            'class_participation',
            'classroom_behavior',
            'contact_notes',
            'class_notes',
            'lesson_id',
            'external_link'
        ]

        const conflicts: string[] = []

        fieldsThatMatter.forEach((field) => {
            const serverValue = (server as Record<string, any>)[field]
            const clientValue = (client as Record<string, any>)[field]

            if (serverValue !== clientValue) {
                conflicts.push(field)
            }
        })

        return conflicts
    }

    /**
     * Merge two versions using last-write-wins strategy
     * Takes the version with the later timestamp
     */
    static mergeLastWriteWins(
        serverVersion: OccurrenceReportDTO,
        clientVersion: OccurrenceReportDTO
    ): OccurrenceReportDTO {
        const serverTime = new Date(serverVersion.updated_at || 0).getTime()
        const clientTime = new Date(clientVersion.updated_at || 0).getTime()

        return serverTime > clientTime ? serverVersion : clientVersion
    }

    /**
     * Merge two versions with client priority
     * Client changes take precedence where conflicts exist
     */
    static mergeClientPriority(
        serverVersion: OccurrenceReportDTO,
        clientVersion: OccurrenceReportDTO
    ): OccurrenceReportDTO {
        const merged = { ...serverVersion }
        const conflictingFields = this.findConflictingFields(serverVersion, clientVersion)

        conflictingFields.forEach((field) => {
            (merged as Record<string, any>)[field] = (clientVersion as Record<string, any>)[field]
        })

        return merged
    }

    /**
     * Merge two versions with server priority
     * Server changes take precedence where conflicts exist
     */
    static mergeServerPriority(
        serverVersion: OccurrenceReportDTO
    ): OccurrenceReportDTO {
        // Server is already the base, just return it
        return serverVersion
    }

    /**
     * Intelligent field-level merge
     * Content field uses last-write-wins
     * Metadata fields (attendance, completion) use server priority
     * Notes fields use merge (concatenate non-empty values)
     */
    static mergeFieldLevel(
        serverVersion: OccurrenceReportDTO,
        clientVersion: OccurrenceReportDTO
    ): OccurrenceReportDTO {
        const merged = { ...serverVersion } as OccurrenceReportDTO

        // Content: last-write-wins
        const serverContentTime = new Date(serverVersion.updated_at || 0).getTime()
        const clientContentTime = new Date(clientVersion.updated_at || 0).getTime()
        if (clientContentTime > serverContentTime && clientVersion.content) {
            merged.content = clientVersion.content
        }

        // Metadata: server priority (attendance_status, is_completed)
        merged.attendance_status = serverVersion.attendance_status
        merged.is_completed = serverVersion.is_completed

        // Notes: merge (concatenate if both have content)
        if (clientVersion.contact_notes && clientVersion.contact_notes !== serverVersion.contact_notes) {
            merged.contact_notes = this.mergeNotes(serverVersion.contact_notes || null, clientVersion.contact_notes)
        }

        if (clientVersion.class_notes && clientVersion.class_notes !== serverVersion.class_notes) {
            merged.class_notes = this.mergeNotes(serverVersion.class_notes || null, clientVersion.class_notes)
        }

        // Ratings/selects: client priority
        if (clientVersion.progress_letter && clientVersion.progress_letter !== serverVersion.progress_letter) {
            merged.progress_letter = clientVersion.progress_letter
        }

        if (clientVersion.class_participation && clientVersion.class_participation !== serverVersion.class_participation) {
            merged.class_participation = clientVersion.class_participation
        }

        if (clientVersion.classroom_behavior && clientVersion.classroom_behavior !== serverVersion.classroom_behavior) {
            merged.classroom_behavior = clientVersion.classroom_behavior
        }

        // Lesson & Link: server priority (structural)
        merged.lesson_id = serverVersion.lesson_id
        merged.external_link = serverVersion.external_link

        return merged
    }

    /**
     * Merge note fields by combining both
     */
    private static mergeNotes(serverNotes: string | null, clientNotes: string | null): string {
        const parts = []

        if (serverNotes) parts.push(`[Server]: ${serverNotes}`)
        if (clientNotes) parts.push(`[Client]: ${clientNotes}`)

        return parts.join('\n\n')
    }

    /**
     * Apply merge strategy to resolve conflicts
     */
    static applyMergeStrategy(
        serverVersion: OccurrenceReportDTO,
        clientVersion: OccurrenceReportDTO,
        strategy: 'last-write-wins' | 'client-priority' | 'server-priority' | 'field-merge' = 'last-write-wins'
    ): OccurrenceReportDTO {
        switch (strategy) {
            case 'last-write-wins':
                return this.mergeLastWriteWins(serverVersion, clientVersion)
            case 'client-priority':
                return this.mergeClientPriority(serverVersion, clientVersion)
            case 'server-priority':
                return this.mergeServerPriority(serverVersion)
            case 'field-merge':
                return this.mergeFieldLevel(serverVersion, clientVersion)
            default:
                return this.mergeLastWriteWins(serverVersion, clientVersion)
        }
    }

    /**
     * Check if a conflict can be automatically resolved
     */
    static canAutoResolve(conflict: ConflictInfo): boolean {
        // Auto-resolve if only non-critical fields conflict
        const nonCriticalFields = ['contact_notes', 'class_notes', 'external_link']
        
        return conflict.conflictingFields.every((field) =>
            nonCriticalFields.includes(field)
        )
    }

    /**
     * Get a human-readable description of the conflict
     */
    static describeConflict(conflict: ConflictInfo): string {
        if (!conflict.hasConflict) {
            return 'No conflicts detected'
        }

        const fields = conflict.conflictingFields.map((f) => {
            const serverVal = (conflict.serverVersion as Record<string, any>)[f]
            const clientVal = (conflict.clientVersion as Record<string, any>)[f]
            return `${f}: "${serverVal}" → "${clientVal}"`
        })

        return `Conflicts in: ${fields.join(', ')}`
    }
}
