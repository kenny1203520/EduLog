<script setup lang="ts">
import RealtimeStatusBadge, { type RealtimeBadgeTone } from '@/components/ui/RealtimeStatusBadge.vue'
import TimeZoneSelect from '@/components/ui/TimeZoneSelect.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/dateUtils'

defineProps<{
    session: any
    sessionTimeLabel: string
    realtimeBadge: { tone: RealtimeBadgeTone; label: string; canRetry: boolean }
    realtimeStatusMessage: string
    realtimeStatusDetail: string
    lastRealtimeUpdateAt: Date | null
    lastRealtimeUpdateLabel: string
    realtimeRefreshError: boolean
    isRealtimeRefreshing: boolean
    showSplitView: boolean
}>()

const emit = defineEmits<{
    'retry-realtime': []
    'refresh-schedule': []
    'close-split-view': []
}>()

const preferences = usePreferencesStore()
</script>

<template>
    <div class="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-start gap-3 sm:gap-4">
                <router-link :to="{ name: 'classrooms' }"
                    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-gray-100 bg-white text-gray-400 shadow-sm transition-all hover:border-emerald-100 hover:bg-emerald-50 hover:text-emerald-600 active:scale-90 sm:h-12 sm:w-12"
                    :aria-label="$t('common.back')">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 sm:h-6 sm:w-6" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M15 19l-7-7 7-7" />
                    </svg>
                </router-link>

                <div class="min-w-0 flex-1" v-if="session">
                    <h1 class="break-words text-2xl font-black leading-tight tracking-tight text-gray-900 sm:text-3xl">
                        {{ session.name }}
                    </h1>
                    <div class="mt-3 flex min-w-0 flex-wrap gap-2 text-xs font-bold text-gray-500 sm:text-sm">
                        <RealtimeStatusBadge
                            align="start"
                            :tone="realtimeBadge.tone"
                            :label="realtimeBadge.label"
                            :message="realtimeStatusMessage"
                            :detail="realtimeStatusDetail ? `${$t('classroom.live_update_detail')} ${realtimeStatusDetail}` : null"
                            :note="lastRealtimeUpdateAt ? $t('classroom.live_update_time', { time: lastRealtimeUpdateLabel }) : null"
                            :can-retry="realtimeBadge.canRetry"
                            :retry-label="realtimeRefreshError ? $t('classroom.live_update_retry') : $t('classroom.live_reconnect')"
                            :busy="isRealtimeRefreshing"
                            :status-label="$t('classroom.live_badge_aria')"
                            @retry="emit('retry-realtime')" />
                        <span class="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            <span class="break-words">{{ session.classroom_name }}</span>
                        </span>
                        <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {{ sessionTimeLabel }}
                        </span>
                        <span class="inline-grid max-w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-gray-100">
                            <span class="whitespace-nowrap text-[10px] font-black uppercase tracking-wide text-gray-400">{{ $t('classroom.session_time_zone') }}</span>
                            <span class="min-w-0 [overflow-wrap:anywhere]">{{ DateUtils.formatTimeZoneLabel(session.time_zone || preferences.timeZone, preferences.locale) }}</span>
                        </span>
                        <a v-if="session.external_link" :href="session.external_link" target="_blank"
                            rel="noopener noreferrer" :title="session.external_link"
                            class="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700 ring-1 ring-emerald-100 transition hover:bg-emerald-100">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            {{ $t('classroom.external_link') }}
                        </a>
                        <a v-if="session.classroom?.external_link" :href="session.classroom.external_link"
                            target="_blank" rel="noopener noreferrer" :title="session.classroom.external_link"
                            class="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-50 px-3 py-2 text-blue-700 ring-1 ring-blue-100 transition hover:bg-blue-100">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            {{ $t('classroom.room_external_link') }}
                        </a>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:max-w-md xl:w-[22rem] xl:shrink-0">
            <div class="min-w-0">
                <TimeZoneSelect :label="$t('common.display_time_zone')" dense />
            </div>
            <button @click="emit('refresh-schedule')"
                class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white text-gray-400 shadow-sm transition-all hover:border-emerald-100 hover:bg-emerald-50 hover:text-emerald-600 active:scale-90"
                :title="$t('classroom.refresh_schedule')" :aria-label="$t('classroom.refresh_schedule')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </button>
            <button v-if="showSplitView" @click="emit('close-split-view')"
                class="col-span-full rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-600 transition hover:bg-gray-200">
                {{ $t('common.close_split_view') }}
            </button>
        </div>
    </div>
</template>
