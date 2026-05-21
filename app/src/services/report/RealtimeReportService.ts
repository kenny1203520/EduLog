import { supabase } from '@/lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

export interface ReportLockInfo {
    id: string
    occurrence_report_id: string
    locked_by: string
    acquired_at: string
    expires_at: string
}

export interface ActiveEditor {
    editor_id: string
    editing_start_time: string
    last_heartbeat: string
}

export interface SyncMetadata {
    id: string
    occurrence_report_id: string
    last_synced_at: string | null
    last_synced_by: string | null
    last_synced_version: number
    conflict_detected: boolean
    conflict_resolution_strategy: string
    conflicting_editors: string[] | null
}

export interface RealtimeUpdate {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new?: OccurrenceReportDTO
    old?: OccurrenceReportDTO
    timestamp: string
    edited_by: string
}

export class RealtimeReportService {
    private static subscriptions: Map<string, RealtimeChannel> = new Map()
    private static heartbeatIntervals: Map<string, ReturnType<typeof setInterval>> = new Map()

    /**
     * Subscribe to real-time changes for a specific report
     */
    static subscribeToReport(
        reportId: string,
        onUpdate: (update: RealtimeUpdate) => void
    ): RealtimeChannel {
        const channelName = `report:${reportId}`

        // Check if already subscribed
        if (this.subscriptions.has(channelName)) {
            return this.subscriptions.get(channelName)!
        }

        const channel = supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'occurrence_reports',
                    filter: `id=eq.${reportId}`
                },
                (payload) => {
                    const update: RealtimeUpdate = {
                        eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
                        new: payload.new as OccurrenceReportDTO,
                        old: payload.old as OccurrenceReportDTO,
                        timestamp: new Date().toISOString(),
                        edited_by: (payload.new as any)?.last_edited_by || ''
                    }
                    onUpdate(update)
                }
            )
            .subscribe((status) => {
                console.log(`Realtime subscription status: ${status}`)
            })

        this.subscriptions.set(channelName, channel)
        return channel
    }

    /**
     * Subscribe to active editors for a report
     */
    static subscribeToActiveEditors(
        reportId: string,
        onEditorsChange: (editors: ActiveEditor[]) => void
    ): RealtimeChannel {
        const channelName = `editors:${reportId}`

        const channel = supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'active_report_editors',
                    filter: `occurrence_report_id=eq.${reportId}`
                },
                async () => {
                    // Fetch updated list
                    const editors = await this.getActiveEditors(reportId)
                    onEditorsChange(editors)
                }
            )
            .subscribe()

        return channel
    }

    /**
     * Unsubscribe from report updates
     */
    static unsubscribeFromReport(reportId: string): void {
        const channelName = `report:${reportId}`
        const channel = this.subscriptions.get(channelName)
        
        if (channel) {
            supabase.removeChannel(channel)
            this.subscriptions.delete(channelName)
        }

        // Clean up heartbeat
        const heartbeatKey = `heartbeat:${reportId}`
        const interval = this.heartbeatIntervals.get(heartbeatKey)
        if (interval) {
            clearInterval(interval)
            this.heartbeatIntervals.delete(heartbeatKey)
        }
    }

    /**
     * Acquire exclusive lock on report
     */
    static async acquireReportLock(
        reportId: string,
        userId: string,
        durationMinutes: number = 10
    ): Promise<boolean> {
        try {
            const { data, error } = await supabase.rpc(
                'acquire_report_lock',
                {
                    p_report_id: reportId,
                    p_user_id: userId,
                    p_duration_minutes: durationMinutes
                }
            )

            if (error) {
                console.error('Failed to acquire lock:', error)
                return false
            }

            return data && data.length > 0
        } catch (err) {
            console.error('Error acquiring lock:', err)
            return false
        }
    }

    /**
     * Release report lock
     */
    static async releaseReportLock(reportId: string, userId: string): Promise<void> {
        try {
            await supabase.rpc('release_report_lock', {
                p_report_id: reportId,
                p_user_id: userId
            })
        } catch (err) {
            console.error('Error releasing lock:', err)
        }
    }

    /**
     * Check if report is locked by another user
     */
    static async getReportLock(reportId: string): Promise<ReportLockInfo | null> {
        try {
            const { data, error } = await supabase
                .from('report_locks')
                .select('*')
                .eq('occurrence_report_id', reportId)
                .gt('expires_at', new Date().toISOString())
                .maybeSingle()

            if (error) {
                return null
            }

            return data as ReportLockInfo
        } catch (err) {
            return null
        }
    }

    /**
     * Update heartbeat to maintain presence
     */
    static async updateHeartbeat(reportId: string, userId: string): Promise<ActiveEditor | null> {
        try {
            const { data, error } = await supabase.rpc(
                'update_editor_heartbeat',
                {
                    p_report_id: reportId,
                    p_user_id: userId
                }
            )

            if (error) {
                console.error('Failed to update heartbeat:', error)
                return null
            }

            return data && data.length > 0 ? data[0] : null
        } catch (err) {
            console.error('Error updating heartbeat:', err)
            return null
        }
    }

    /**
     * Start automatic heartbeat for presence tracking
     */
    static startHeartbeat(reportId: string, userId: string, intervalSeconds: number = 5): void {
        const heartbeatKey = `heartbeat:${reportId}`

        // Clear any existing heartbeat
        const existingInterval = this.heartbeatIntervals.get(heartbeatKey)
        if (existingInterval) {
            clearInterval(existingInterval)
        }

        // Set up new heartbeat
        const interval = setInterval(() => {
            this.updateHeartbeat(reportId, userId)
        }, intervalSeconds * 1000)

        this.heartbeatIntervals.set(heartbeatKey, interval)
    }

    /**
     * Stop automatic heartbeat
     */
    static stopHeartbeat(reportId: string): void {
        const heartbeatKey = `heartbeat:${reportId}`
        const interval = this.heartbeatIntervals.get(heartbeatKey)
        
        if (interval) {
            clearInterval(interval)
            this.heartbeatIntervals.delete(heartbeatKey)
        }
    }

    /**
     * Get list of active editors for a report
     */
    static async getActiveEditors(reportId: string): Promise<ActiveEditor[]> {
        try {
            const { data, error } = await supabase.rpc(
                'get_active_editors',
                { p_report_id: reportId }
            )

            if (error) {
                console.error('Failed to get active editors:', error)
                return []
            }

            return (data as ActiveEditor[]) || []
        } catch (err) {
            console.error('Error getting active editors:', err)
            return []
        }
    }

    /**
     * Record sync metadata for conflict tracking
     */
    static async recordSync(
        reportId: string,
        userId: string,
        version: number,
        conflictDetected: boolean = false,
        strategy: string = 'last-write-wins',
        conflictingEditors?: string[]
    ): Promise<SyncMetadata | null> {
        try {
            const { data, error } = await supabase.rpc(
                'record_report_sync',
                {
                    p_report_id: reportId,
                    p_synced_by: userId,
                    p_version: version,
                    p_conflict_detected: conflictDetected,
                    p_strategy: strategy,
                    p_conflicting_editors: conflictingEditors
                }
            )

            if (error) {
                console.error('Failed to record sync:', error)
                return null
            }

            return data && data.length > 0 ? data[0] : null
        } catch (err) {
            console.error('Error recording sync:', err)
            return null
        }
    }

    /**
     * Clean up all subscriptions and timers
     */
    static cleanup(): void {
        // Unsubscribe from all channels
        this.subscriptions.forEach((channel) => {
            supabase.removeChannel(channel)
        })
        this.subscriptions.clear()

        // Clear all heartbeat intervals
        this.heartbeatIntervals.forEach((interval) => {
            clearInterval(interval)
        })
        this.heartbeatIntervals.clear()
    }
}
