<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Pagination from '@/components/ui/Pagination.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import { useFeedback } from '@/composables/useFeedback'
import type { ApiMeta } from '@/services/api/ApiV1Client'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { DateUtils } from '@/utils/dateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { buildAuditEventQuery, type AuditEventFilters } from '@/services/audit/AuditEventQuery'

type AuditEvent = {
    id: string
    actor_user_id?: string | null
    action?: string | null
    domain?: string | null
    resource?: string | null
    resource_id?: string | null
    scope_id?: string | null
    request_id?: string | null
    outcome?: string | null
    metadata?: Record<string, unknown> | null
    created_at?: string | null
}
type AuditUser = { id: string; display_name?: string | null; email?: string | null }

const { t, te } = useI18n()
const { errorKey, reportError, success } = useFeedback()
const preferences = usePreferencesStore()
const events = ref<AuditEvent[]>([])
const auditUsers = ref<AuditUser[]>([])
const actorLookupAvailable = ref(false)
const loading = ref(false)
const loaded = ref(false)
const loadError = ref(false)
const actorLoading = ref(false)
const totalItems = ref(0)
const selectedEvent = ref<AuditEvent | null>(null)
const detailDialog = ref<HTMLDialogElement | null>(null)
const pagination = reactive({ page: 1, perPage: 20 })
const defaultFilters = (): AuditEventFilters => ({ from: '', to: '', actorUserId: '', domain: '', outcome: '', resource: '', action: '', search: '' })
const pendingFilters = reactive(defaultFilters())
const appliedFilters = ref<AuditEventFilters>(defaultFilters())

const auditUserOptions = computed(() => auditUsers.value.map(user => ({
    value: user.id,
    label: user.display_name?.trim() || user.email || user.id,
    description: user.email || '',
    searchText: `${user.display_name ?? ''} ${user.email ?? ''}`,
})))
const actorNameById = computed(() => new Map(auditUsers.value.map(user => [user.id, user.display_name?.trim() || user.email || user.id])))
const actorEmailById = computed(() => new Map(auditUsers.value.map(user => [user.id, user.email || ''])))
const invalidDateRange = computed(() => Boolean(pendingFilters.from && pendingFilters.to && pendingFilters.to < pendingFilters.from))
const invalidActorId = computed(() => Boolean(pendingFilters.actorUserId && !isUuid(pendingFilters.actorUserId)))
const metadataText = computed(() => JSON.stringify(selectedEvent.value?.metadata ?? null, null, 2))

function isUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function valueOrDash(value: unknown) {
    if (value === null || value === undefined || value === '') return t('rbac.audit_value_missing')
    return String(value)
}

function actorName(userId?: string | null) {
    if (!userId) return t('rbac.audit_actor_unknown')
    return actorNameById.value.get(userId) || userId
}

function actorEmail(userId?: string | null) {
    return userId ? actorEmailById.value.get(userId) || '' : ''
}

function eventDate(value?: string | null) {
    if (!value) return t('rbac.audit_value_missing')
    return DateUtils.displayDateTime(value, preferences.locale, preferences.timeZone)
}

function localizedAction(action?: string | null) {
    if (!action) return t('rbac.audit_value_missing')
    const key = `rbac.actions.${action}.name`
    return te(key) ? t(key) : action
}

function domainLabel(domain?: string | null) {
    return domain && te(`rbac.audit_domains.${domain}`) ? t(`rbac.audit_domains.${domain}`) : valueOrDash(domain)
}

function outcomeLabel(outcome?: string | null) {
    return outcome && te(`rbac.audit_outcomes.${outcome}`) ? t(`rbac.audit_outcomes.${outcome}`) : valueOrDash(outcome)
}

function metadataValue(event: AuditEvent, key: string) {
    return event.metadata?.[key]
}

async function loadEvents() {
    loading.value = true
    loadError.value = false
    try {
        const query = buildAuditEventQuery(appliedFilters.value, pagination.page, pagination.perPage, preferences.timeZone)
        const result = await apiV1Client.get<AuditEvent[]>(`/audit-events?${query}`)
        events.value = result.data ?? []
        const total = Number((result.meta as ApiMeta & { total?: number } | undefined)?.total)
        totalItems.value = Number.isFinite(total) ? total : events.value.length
        loaded.value = true
    } catch (error) {
        loadError.value = true
        reportError(error)
    } finally {
        loading.value = false
    }
}

async function loadAuditUsers() {
    actorLoading.value = true
    try {
        const limit = 100
        const resultUsers: AuditUser[] = []
        let offset = 0
        let total = Number.POSITIVE_INFINITY
        while (offset < total) {
            const response = await apiV1Client.get<AuditUser[]>(`/users?limit=${limit}&offset=${offset}&sort=display_name`)
            const page = response.data ?? []
            resultUsers.push(...page)
            total = Number((response.meta as ApiMeta & { total?: number } | undefined)?.total ?? resultUsers.length)
            if (!page.length) break
            offset += page.length
        }
        auditUsers.value = resultUsers
        actorLookupAvailable.value = resultUsers.length > 0
    } catch {
        // Audit access does not imply permission to read user profiles.
        auditUsers.value = []
        actorLookupAvailable.value = false
    } finally {
        actorLoading.value = false
    }
}

async function applyFilters() {
    if (invalidDateRange.value || invalidActorId.value) return
    appliedFilters.value = { ...pendingFilters, actorUserId: pendingFilters.actorUserId.trim() }
    if (pagination.page === 1) await loadEvents()
    else pagination.page = 1
}

async function resetFilters() {
    Object.assign(pendingFilters, defaultFilters())
    appliedFilters.value = defaultFilters()
    if (pagination.page === 1) await loadEvents()
    else pagination.page = 1
}

function openDetails(event: AuditEvent) {
    selectedEvent.value = event
}

function closeDetails() {
    detailDialog.value?.close()
    selectedEvent.value = null
}

async function copyValue(value: unknown) {
    if (typeof value !== 'string' || !value) return
    try {
        await navigator.clipboard.writeText(value)
        success('rbac.audit_copied')
    } catch {
        errorKey('rbac.audit_copy_failed')
    }
}

watch(() => [pagination.page, pagination.perPage], () => { void loadEvents() })
watch(selectedEvent, async event => {
    if (!event) return
    await nextTick()
    if (detailDialog.value && !detailDialog.value.open) detailDialog.value.showModal()
})
onMounted(() => {
    void loadEvents()
    void loadAuditUsers()
})
</script>

<template>
    <section class="space-y-5">
        <div class="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 class="font-black text-gray-900">{{ t('rbac.audit_title') }}</h3>
                    <p class="mt-1 text-sm text-gray-500">{{ t('rbac.audit_description') }}</p>
                </div>
                <p v-if="!loading && loaded" class="rounded-full bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600" aria-live="polite">
                    {{ t('rbac.audit_total', { count: totalItems }) }}
                </p>
            </div>

            <form class="grid gap-3 rounded-xl border border-gray-100 bg-slate-50/70 p-3 sm:grid-cols-2 xl:grid-cols-4" @submit.prevent="applyFilters">
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_from') }}</span>
                    <input v-model="pendingFilters.from" type="date" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" />
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_to') }}</span>
                    <input v-model="pendingFilters.to" type="date" :min="pendingFilters.from || undefined" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" />
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_actor') }}</span>
                    <SearchableSelect v-if="actorLookupAvailable" v-model="pendingFilters.actorUserId" :options="auditUserOptions" :placeholder="t('rbac.audit_filter_actor_search')" :aria-label="t('rbac.audit_filter_actor')" />
                    <input v-else v-model="pendingFilters.actorUserId" :disabled="actorLoading" type="text" :placeholder="actorLoading ? t('common.loading') : t('rbac.audit_filter_actor_id')" :aria-label="t('rbac.audit_filter_actor_id')" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-60" />
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_domain') }}</span>
                    <select v-model="pendingFilters.domain" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
                        <option value="">{{ t('rbac.audit_filter_any') }}</option>
                        <option value="system">{{ t('rbac.audit_domains.system') }}</option>
                        <option value="teaching">{{ t('rbac.audit_domains.teaching') }}</option>
                    </select>
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_outcome') }}</span>
                    <select v-model="pendingFilters.outcome" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
                        <option value="">{{ t('rbac.audit_filter_any') }}</option>
                        <option value="success">{{ t('rbac.audit_outcomes.success') }}</option>
                        <option value="denied">{{ t('rbac.audit_outcomes.denied') }}</option>
                        <option value="failure">{{ t('rbac.audit_outcomes.failure') }}</option>
                    </select>
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_resource') }}</span>
                    <input v-model="pendingFilters.resource" type="search" :placeholder="t('rbac.audit_filter_resource_hint')" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"  :aria-label="t('rbac.audit_filter_resource_hint')"/>
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600">
                    <span>{{ t('rbac.audit_filter_action') }}</span>
                    <input v-model="pendingFilters.action" type="search" :placeholder="t('rbac.audit_filter_action_hint')" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"  :aria-label="t('rbac.audit_filter_action_hint')"/>
                </label>
                <label class="space-y-1 text-xs font-bold text-gray-600 sm:col-span-2 xl:col-span-2">
                    <span>{{ t('rbac.audit_filter_search') }}</span>
                    <input v-model="pendingFilters.search" type="search" :placeholder="t('rbac.audit_filter_search_hint')" class="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-normal text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"  :aria-label="t('rbac.audit_filter_search_hint')"/>
                </label>
                <p v-if="invalidDateRange" role="alert" class="text-sm font-semibold text-rose-700 sm:col-span-2 xl:col-span-4">{{ t('rbac.audit_invalid_date_range') }}</p>
                <p v-if="invalidActorId" role="alert" class="text-sm font-semibold text-rose-700 sm:col-span-2 xl:col-span-4">{{ t('rbac.audit_invalid_actor_id') }}</p>
                <div class="flex flex-wrap justify-end gap-2 sm:col-span-2 xl:col-span-4">
                    <button type="button" class="min-h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" @click="resetFilters">{{ t('rbac.audit_reset_filters') }}</button>
                    <button type="submit" :disabled="loading || invalidDateRange || invalidActorId" class="min-h-10 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{{ t('rbac.audit_apply_filters') }}</button>
                </div>
            </form>

            <p v-if="loading" class="py-8 text-center text-sm text-gray-500" role="status">{{ t('common.loading') }}</p>
            <div v-else-if="loadError" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-8 text-center">
                <p class="text-sm font-semibold text-rose-800" role="alert">{{ t('rbac.audit_load_failed') }}</p>
                <button type="button" class="mt-3 min-h-10 rounded-lg border border-rose-300 bg-white px-4 text-sm font-bold text-rose-800 hover:bg-rose-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-600" @click="loadEvents">{{ t('rbac.audit_retry') }}</button>
            </div>
            <div v-else class="mt-4 overflow-x-auto rounded-xl border border-gray-100">
                <table class="min-w-[760px] w-full text-left text-sm">
                    <thead class="bg-slate-50 text-xs uppercase text-gray-500">
                        <tr>
                            <th scope="col" class="px-3 py-3">{{ t('rbac.audit_action') }}</th>
                            <th scope="col" class="px-3 py-3">{{ t('rbac.audit_outcome') }}</th>
                            <th scope="col" class="px-3 py-3">{{ t('rbac.audit_actor') }}</th>
                            <th scope="col" class="px-3 py-3">{{ t('rbac.audit_resource') }}</th>
                            <th scope="col" class="px-3 py-3">{{ t('rbac.audit_time') }}</th>
                            <th scope="col" class="px-3 py-3"><span class="sr-only">{{ t('rbac.audit_detail') }}</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="event in events" :key="event.id" class="border-t border-gray-100 align-top hover:bg-emerald-50/40">
                            <td class="px-3 py-3">
                                <p class="font-bold text-gray-900">{{ localizedAction(event.action) }}</p>
                                <p class="mt-0.5 text-xs text-gray-500">{{ domainLabel(event.domain) }}</p>
                            </td>
                            <td class="px-3 py-3"><span class="inline-flex rounded-full px-2.5 py-1 text-xs font-bold" :class="event.outcome === 'success' ? 'bg-emerald-50 text-emerald-800' : event.outcome === 'denied' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'">{{ outcomeLabel(event.outcome) }}</span></td>
                            <td class="max-w-52 px-3 py-3"><p class="truncate font-medium text-gray-800">{{ actorName(event.actor_user_id) }}</p><p v-if="actorEmail(event.actor_user_id)" class="truncate text-xs text-gray-500">{{ actorEmail(event.actor_user_id) }}</p></td>
                            <td class="px-3 py-3"><p class="font-medium text-gray-800">{{ valueOrDash(event.resource) }}</p><p class="mt-0.5 max-w-44 truncate text-xs text-gray-500">{{ valueOrDash(event.resource_id) }}</p></td>
                            <td class="whitespace-nowrap px-3 py-3 text-xs text-gray-600">{{ eventDate(event.created_at) }}</td>
                            <td class="px-3 py-3"><button type="button" class="min-h-9 rounded-lg border border-emerald-200 px-3 text-xs font-bold text-emerald-800 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :aria-label="t('rbac.audit_view_details_for', { action: localizedAction(event.action), resource: valueOrDash(event.resource) })" @click="openDetails(event)">{{ t('rbac.audit_view_details') }}</button></td>
                        </tr>
                        <tr v-if="events.length === 0"><td colspan="6" class="px-4 py-10 text-center text-sm text-gray-500">{{ t('rbac.audit_empty') }}</td></tr>
                    </tbody>
                </table>
            </div>
            <Pagination v-if="!loading && totalItems > 0" :model-value="pagination.page" :per-page="pagination.perPage" :total-items="totalItems" @update:model-value="pagination.page = $event" @update:per-page="pagination.perPage = $event" />
        </div>

        <dialog ref="detailDialog" class="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[min(88dvh,48rem)] w-full max-w-none translate-y-0 overflow-y-auto overscroll-contain rounded-t-2xl rounded-b-none p-0 pb-[env(safe-area-inset-bottom)] shadow-2xl backdrop:bg-slate-950/50 sm:inset-0 sm:m-auto sm:max-h-[90dvh] sm:w-[min(46rem,calc(100vw-2rem))] sm:rounded-2xl sm:pb-0" aria-labelledby="audit-detail-title" @close="selectedEvent = null" @click.self="closeDetails">
            <article v-if="selectedEvent" class="bg-white">
                <header class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-gray-100 bg-white px-5 py-4 sm:px-6">
                    <div class="min-w-0">
                        <p class="text-xs font-bold uppercase tracking-wide text-emerald-700">{{ t('rbac.audit_detail') }}</p>
                        <h3 id="audit-detail-title" class="mt-1 break-words text-lg font-black text-gray-900">{{ localizedAction(selectedEvent.action) }} · {{ valueOrDash(selectedEvent.resource) }}</h3>
                        <p class="mt-1 text-sm text-gray-500">{{ eventDate(selectedEvent.created_at) }}</p>
                    </div>
                    <button type="button" class="min-h-10 shrink-0 rounded-lg border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" @click="closeDetails">{{ t('common.close') }}</button>
                </header>
                <div class="space-y-5 p-5 sm:p-6">
                    <section aria-labelledby="audit-detail-actor-heading" class="grid gap-3 sm:grid-cols-2">
                        <div class="rounded-xl bg-slate-50 p-3">
                            <h4 id="audit-detail-actor-heading" class="text-xs font-bold uppercase tracking-wide text-gray-500">{{ t('rbac.audit_actor') }}</h4>
                            <p class="mt-1 break-all font-semibold text-gray-900">{{ actorName(selectedEvent.actor_user_id) }}</p>
                            <p v-if="actorEmail(selectedEvent.actor_user_id)" class="break-all text-sm text-gray-600">{{ actorEmail(selectedEvent.actor_user_id) }}</p>
                            <p class="mt-1 break-all font-mono text-xs text-gray-500">{{ valueOrDash(selectedEvent.actor_user_id) }}</p>
                        </div>
                        <div class="rounded-xl bg-slate-50 p-3">
                            <h4 class="text-xs font-bold uppercase tracking-wide text-gray-500">{{ t('rbac.audit_outcome') }}</h4>
                            <p class="mt-1 font-semibold text-gray-900">{{ outcomeLabel(selectedEvent.outcome) }}</p>
                            <p class="text-sm text-gray-600">{{ domainLabel(selectedEvent.domain) }}</p>
                            <p class="mt-1 text-xs text-gray-500">{{ t('rbac.audit_http_status') }}: {{ valueOrDash(metadataValue(selectedEvent, 'status')) }}</p>
                        </div>
                    </section>
                    <section aria-labelledby="audit-detail-resource-heading" class="rounded-xl border border-gray-100 p-3">
                        <h4 id="audit-detail-resource-heading" class="text-sm font-black text-gray-900">{{ t('rbac.audit_resource_section') }}</h4>
                        <dl class="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_resource') }}</dt><dd class="mt-0.5 break-all font-medium text-gray-900">{{ valueOrDash(selectedEvent.resource) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_resource_id') }}</dt><dd class="mt-0.5 break-all font-mono text-xs text-gray-800">{{ valueOrDash(selectedEvent.resource_id) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_scope_id') }}</dt><dd class="mt-0.5 break-all font-mono text-xs text-gray-800">{{ valueOrDash(selectedEvent.scope_id) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_permission') }}</dt><dd class="mt-0.5 break-all font-mono text-xs text-gray-800">{{ valueOrDash(metadataValue(selectedEvent, 'permission')) }}</dd></div>
                        </dl>
                    </section>
                    <section aria-labelledby="audit-detail-request-heading" class="rounded-xl border border-gray-100 p-3">
                        <h4 id="audit-detail-request-heading" class="text-sm font-black text-gray-900">{{ t('rbac.audit_request_section') }}</h4>
                        <dl class="mt-3 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_route') }}</dt><dd class="mt-0.5 break-all font-mono text-xs text-gray-800">{{ valueOrDash(metadataValue(selectedEvent, 'route')) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_http_method') }}</dt><dd class="mt-0.5 font-medium text-gray-900">{{ valueOrDash(metadataValue(selectedEvent, 'method')) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_latency') }}</dt><dd class="mt-0.5 text-gray-900">{{ metadataValue(selectedEvent, 'latency_ms') == null ? t('rbac.audit_value_missing') : t('rbac.audit_latency_ms', { count: metadataValue(selectedEvent, 'latency_ms') }) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_error_code') }}</dt><dd class="mt-0.5 break-all font-mono text-xs text-gray-800">{{ valueOrDash(metadataValue(selectedEvent, 'error_code')) }}</dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_request_id') }}</dt><dd class="mt-1 flex min-w-0 items-center gap-2"><span class="break-all font-mono text-xs text-gray-800">{{ valueOrDash(selectedEvent.request_id) }}</span><button v-if="selectedEvent.request_id" type="button" class="min-h-9 shrink-0 rounded-md border border-gray-200 px-2 text-xs font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :aria-label="t('rbac.audit_copy_request_id')" @click="copyValue(selectedEvent.request_id)">{{ t('rbac.audit_copy') }}</button></dd></div>
                            <div><dt class="text-xs font-semibold text-gray-500">{{ t('rbac.audit_trace_id') }}</dt><dd class="mt-1 flex min-w-0 items-center gap-2"><span class="break-all font-mono text-xs text-gray-800">{{ valueOrDash(metadataValue(selectedEvent, 'trace_id')) }}</span><button v-if="typeof metadataValue(selectedEvent, 'trace_id') === 'string'" type="button" class="min-h-9 shrink-0 rounded-md border border-gray-200 px-2 text-xs font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :aria-label="t('rbac.audit_copy_trace_id')" @click="copyValue(metadataValue(selectedEvent, 'trace_id'))">{{ t('rbac.audit_copy') }}</button></dd></div>
                        </dl>
                    </section>
                    <details class="rounded-xl border border-gray-100">
                        <summary class="cursor-pointer rounded-xl px-3 py-3 text-sm font-bold text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">{{ t('rbac.audit_metadata') }}</summary>
                        <pre class="max-h-72 overflow-auto border-t border-gray-100 bg-slate-50 p-3 text-xs leading-relaxed text-gray-800">{{ metadataText }}</pre>
                    </details>
                </div>
            </article>
        </dialog>
    </section>
</template>
