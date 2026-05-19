<template>
    <div class="active-editors-indicator">
        <!-- Presence Badge -->
        <div v-if="hasOtherEditors" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
            <!-- Avatar Stack -->
            <div class="flex -space-x-2">
                <div v-for="editor in otherEditors.slice(0, 3)" :key="editor.userId"
                    class="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold border-2 border-blue-50 tooltip"
                    :style="{ backgroundColor: editor.color }"
                    :title="editor.displayName">
                    {{ editor.displayName.charAt(0).toUpperCase() }}
                </div>
                <div v-if="otherEditors.length > 3" class="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold bg-gray-400 border-2 border-blue-50 tooltip"
                    :title="`+${otherEditors.length - 3} more`">
                    +{{ otherEditors.length - 3 }}
                </div>
            </div>

            <!-- Presence Text -->
            <span class="text-sm font-medium text-blue-700">
                {{ presenceString }}
            </span>

            <!-- Details on Hover -->
            <div v-if="otherEditors.length > 0" class="hidden group-hover:block absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-max z-50">
                <div v-for="editor in otherEditors" :key="editor.userId" class="px-3 py-2 text-sm text-gray-700 border-b last:border-b-0">
                    <div class="flex items-center gap-2">
                        <div class="w-3 h-3 rounded-full" :style="{ backgroundColor: editor.color }" />
                        <div>
                            <div class="font-medium">{{ editor.displayName }}</div>
                            <div class="text-xs text-gray-500">{{ editor.email }}</div>
                            <div class="text-xs text-gray-400">
                                Editing for {{ getEditingDuration(editor.editingStartTime) }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Lock Status -->
        <div v-if="isLockedByOther" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
            <svg class="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" />
            </svg>
            <span class="text-sm font-medium text-amber-700">Report is locked</span>
        </div>

        <!-- Conflict Warning -->
        <div v-if="hasConflict" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200">
            <svg class="w-4 h-4 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            <div class="flex flex-col gap-1">
                <span class="text-sm font-medium text-red-700">Conflict detected</span>
                <span class="text-xs text-red-600">{{ conflictMessage }}</span>
            </div>
        </div>

        <!-- Syncing Status -->
        <div v-if="isSyncing" class="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
            <svg class="w-4 h-4 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span class="text-sm font-medium text-blue-700">Syncing changes...</span>
        </div>

        <!-- Last Sync Time -->
        <div v-if="lastSyncTime && !isSyncing" class="text-xs text-gray-500">
            Last synced: {{ getTimeSinceSync(lastSyncTime) }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { EditorPresence } from '@/services/report/PresenceService'

interface Props {
    activeEditors?: EditorPresence[]
    isLockedByOther?: boolean
    hasConflict?: boolean
    conflictMessage?: string | null
    isSyncing?: boolean
    lastSyncTime?: Date | null
}

const props = withDefaults(defineProps<Props>(), {
    activeEditors: () => [],
    isLockedByOther: false,
    hasConflict: false,
    conflictMessage: null,
    isSyncing: false,
    lastSyncTime: null
})

const otherEditors = computed(() => props.activeEditors || [])

const hasOtherEditors = computed(() => otherEditors.value.length > 0)

const presenceString = computed(() => {
    if (otherEditors.value.length === 0) return ''

    const names = otherEditors.value.map((e) => e.displayName)

    if (names.length === 1) {
        return `${names[0]} is editing`
    }

    if (names.length === 2) {
        return `${names.join(' and ')} are editing`
    }

    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]} are editing`
})

/**
 * Format editing duration as human-readable string
 */
const getEditingDuration = (startTime: Date): string => {
    const now = new Date().getTime()
    const start = new Date(startTime).getTime()
    const diff = Math.floor((now - start) / 1000)

    if (diff < 60) return `${diff}s`
    if (diff < 3600) return `${Math.floor(diff / 60)}m`
    return `${Math.floor(diff / 3600)}h`
}

/**
 * Format time since last sync
 */
const getTimeSinceSync = (syncTime: Date): string => {
    const now = new Date().getTime()
    const sync = new Date(syncTime).getTime()
    const diff = Math.floor((now - sync) / 1000)

    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
}
</script>

<style scoped>
.active-editors-indicator {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.tooltip {
    cursor: help;
}

.group-hover\:block {
    display: none;
}

.active-editors-indicator:hover .group-hover\:block {
    display: block;
}
</style>
