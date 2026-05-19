import { supabase } from '@/lib/supabase'

export interface EditorPresence {
    userId: string
    email: string
    displayName: string
    editingStartTime: Date
    lastHeartbeat: Date
    isActive: boolean
    color?: string
}

/**
 * Service for managing editor presence in realtime collaboration
 */
export class PresenceService {
    private static presenceCache: Map<string, Map<string, EditorPresence>> = new Map()
    private static userColorMap: Map<string, string> = new Map()
    private static readonly COLORS = [
        '#FF6B6B', // red
        '#4ECDC4', // teal
        '#45B7D1', // blue
        '#FFA07A', // light salmon
        '#98D8C8', // mint
        '#F7DC6F', // yellow
        '#BB8FCE', // purple
        '#85C1E2', // light blue
        '#F8B88B', // peach
        '#85E1A0'  // light green
    ]

    /**
     * Get unique color for a user
     */
    private static getUserColor(userId: string): string {
        if (!this.userColorMap.has(userId)) {
            const colorIndex = this.userColorMap.size % this.COLORS.length
            this.userColorMap.set(userId, this.COLORS[colorIndex])
        }
        return this.userColorMap.get(userId)!
    }

    /**
     * Add presence information for active editors
     */
    static async addPresence(
        reportId: string,
        userId: string,
        userEmail: string,
        userDisplayName: string
    ): Promise<EditorPresence | null> {
        try {
            const { data, error } = await supabase.rpc('update_editor_heartbeat', {
                p_report_id: reportId,
                p_user_id: userId
            })

            if (error) {
                console.error('Failed to add presence:', error)
                return null
            }

            if (!data || data.length === 0) return null

            const presence: EditorPresence = {
                userId,
                email: userEmail,
                displayName: userDisplayName,
                editingStartTime: new Date(data[0].editing_start_time),
                lastHeartbeat: new Date(data[0].last_heartbeat),
                isActive: true,
                color: this.getUserColor(userId)
            }

            // Update cache
            if (!this.presenceCache.has(reportId)) {
                this.presenceCache.set(reportId, new Map())
            }
            this.presenceCache.get(reportId)!.set(userId, presence)

            return presence
        } catch (err) {
            console.error('Error adding presence:', err)
            return null
        }
    }

    /**
     * Remove presence information when editor leaves
     */
    static async removePresence(reportId: string, userId: string): Promise<void> {
        try {
            // Delete from database
            const { error } = await supabase
                .from('active_report_editors')
                .delete()
                .eq('occurrence_report_id', reportId)
                .eq('editor_id', userId)

            if (error) {
                console.error('Failed to remove presence:', error)
                return
            }

            // Update cache
            if (this.presenceCache.has(reportId)) {
                this.presenceCache.get(reportId)!.delete(userId)
            }
        } catch (err) {
            console.error('Error removing presence:', err)
        }
    }

    /**
     * Get all active editors for a report
     */
    static async getActivePresence(reportId: string): Promise<EditorPresence[]> {
        try {
            const { data, error } = await supabase.rpc('get_active_editors', {
                p_report_id: reportId
            })

            if (error) {
                console.error('Failed to get active editors:', error)
                return []
            }

            if (!data || data.length === 0) {
                return []
            }

            // Fetch user details for display
            const userIds = data.map((d: any) => d.editor_id)
            const { data: users, error: userError } = await supabase
                .from('profiles')
                .select('id, email, display_name')
                .in('id', userIds)

            const userMap = new Map()
            if (!userError && users) {
                users.forEach((u: any) => {
                    userMap.set(u.id, {
                        email: u.email || '',
                        displayName: u.display_name || 'Unknown'
                    })
                })
            }

            const presences: EditorPresence[] = data.map((d: any) => {
                const userInfo = userMap.get(d.editor_id) || {
                    email: 'unknown@example.com',
                    displayName: 'Unknown Editor'
                }

                return {
                    userId: d.editor_id,
                    email: userInfo.email,
                    displayName: userInfo.displayName,
                    editingStartTime: new Date(d.editing_start_time),
                    lastHeartbeat: new Date(d.last_heartbeat),
                    isActive: true,
                    color: this.getUserColor(d.editor_id)
                }
            })

            // Update cache
            if (!this.presenceCache.has(reportId)) {
                this.presenceCache.set(reportId, new Map())
            }

            const reportCache = this.presenceCache.get(reportId)!
            reportCache.clear()
            presences.forEach((p) => {
                reportCache.set(p.userId, p)
            })

            return presences
        } catch (err) {
            console.error('Error getting active presence:', err)
            return []
        }
    }

    /**
     * Update heartbeat for current user's presence
     */
    static async updatePresenceHeartbeat(reportId: string, userId: string): Promise<void> {
        try {
            await supabase.rpc('update_editor_heartbeat', {
                p_report_id: reportId,
                p_user_id: userId
            })
        } catch (err) {
            console.error('Error updating presence heartbeat:', err)
        }
    }

    /**
     * Get cached presence for a report
     */
    static getCachedPresence(reportId: string): EditorPresence[] {
        if (!this.presenceCache.has(reportId)) {
            return []
        }

        return Array.from(this.presenceCache.get(reportId)!.values()).filter((p) => p.isActive)
    }

    /**
     * Get presence for a specific user
     */
    static getPresenceForUser(reportId: string, userId: string): EditorPresence | null {
        if (!this.presenceCache.has(reportId)) {
            return null
        }

        return this.presenceCache.get(reportId)!.get(userId) || null
    }

    /**
     * Check if user is present
     */
    static isUserActive(reportId: string, userId: string): boolean {
        const presence = this.getPresenceForUser(reportId, userId)
        return presence ? presence.isActive : false
    }

    /**
     * Get number of active editors
     */
    static getActiveEditorCount(reportId: string): number {
        if (!this.presenceCache.has(reportId)) {
            return 0
        }

        return Array.from(this.presenceCache.get(reportId)!.values()).filter(
            (p) => p.isActive
        ).length
    }

    /**
     * Format presence as human-readable string
     */
    static formatPresenceString(presences: EditorPresence[]): string {
        if (presences.length === 0) {
            return 'No one else is editing'
        }

        const names = presences.map((p) => p.displayName)

        if (presences.length === 1) {
            return `${names[0]} is editing`
        }

        if (presences.length === 2) {
            return `${names.join(' and ')} are editing`
        }

        return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]} are editing`
    }

    /**
     * Clear all presence data
     */
    static clearPresence(): void {
        this.presenceCache.clear()
    }

    /**
     * Clear presence for specific report
     */
    static clearReportPresence(reportId: string): void {
        this.presenceCache.delete(reportId)
    }
}
