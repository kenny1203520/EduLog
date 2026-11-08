<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useFeedback } from '@/composables/useFeedback'
import { useCapabilityStore } from '@/stores/useCapabilityStore'
import Pagination from '@/components/ui/Pagination.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import BasePageHeader from '@/components/ui/BasePageHeader.vue'
import TeacherListTable from '@/components/teacher/TeacherListTable.vue'
import TeacherDetailPane from '@/components/teacher/TeacherDetailPane.vue'
import TeacherFormDialog from '@/components/teacher/TeacherFormDialog.vue'
import TeacherAccountLinkDialog from '@/components/teacher/TeacherAccountLinkDialog.vue'
import { TeacherService } from '@/services/teacher/TeacherService'
import {
    TeacherDirectoryService,
    type TeacherDirectoryItem,
    type TeacherDirectoryStatistics,
    type TeacherSortField,
    type TeacherStatusFilter,
} from '@/services/teacher/TeacherDirectoryService'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { errorKey, reportError, success } = useFeedback()
const capabilities = useCapabilityStore()

const items = ref<TeacherDirectoryItem[]>([])
const statistics = ref<TeacherDirectoryStatistics>({ totalTeachers: 0, linkedAccounts: 0, unlinkedAccounts: 0, unassignedTeachers: 0, archivedTeachers: 0 })
const total = ref(0)
const loading = ref(true)
const loadFailed = ref(false)
const search = ref('')
const status = ref<TeacherStatusFilter>('active')
const sortField = ref<TeacherSortField>('name')
const descending = ref(false)
const page = ref(1)
const perPage = ref(20)
const checkedIds = ref<Set<string>>(new Set())
const selected = ref<TeacherDirectoryItem | null>(null)
const formOpen = ref(false)
const formTeacherId = ref<string | null>(null)
const linkingTeacherId = ref<string | null>(null)
let loadSequence = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

type PendingAction = { kind: 'archive' | 'restore' | 'delete' | 'bulk-delete'; teacher?: TeacherDirectoryItem }
const pending = ref<PendingAction | null>(null)
const pendingBusy = ref(false)

const canCreate = computed(() => capabilities.canPlatform('teaching.teachers.create'))
const canUpdate = computed(() => capabilities.can('teaching.teachers.update'))
const canArchive = computed(() => capabilities.canPlatform('teaching.teachers.update'))
const canDelete = computed(() => capabilities.can('teaching.teachers.delete'))
const canSensitive = computed(() => capabilities.canPlatform('teaching.teachers.update_sensitive'))
const canReadContact = computed(() => capabilities.canPlatform('teaching.teachers.read_sensitive'))
const canAssign = computed(() => capabilities.can('teaching.class_sessions.update') && capabilities.can('teaching.roles.manage'))

const stats = computed(() => [
    { key: 'total', label: t('teacher.directory.stat_total'), value: statistics.value.totalTeachers },
    { key: 'linked', label: t('teacher.directory.stat_linked'), value: statistics.value.linkedAccounts },
    { key: 'unassigned', label: t('teacher.directory.stat_unassigned'), value: statistics.value.unassignedTeachers },
    { key: 'archived', label: t('teacher.directory.stat_archived'), value: statistics.value.archivedTeachers },
])
const statusOptions = computed(() => (['active', 'archived', 'all'] as const).map(value => ({ value, label: t(`teacher.directory.status_${value}`) })))
const sortOptions = computed(() => [
    { value: 'name', label: t('teacher.sort_name') },
    { value: 'class_count', label: t('teacher.directory.sort_class_count') },
    { value: 'created_at', label: t('teacher.sort_created_at') },
])
const confirmText = computed(() => {
    const action = pending.value
    if (!action) return { title: '', message: '', confirm: '', dangerous: false }
    const name = action.teacher?.name ?? ''
    if (action.kind === 'archive') return { title: t('teacher.directory.archive_title'), message: t('teacher.directory.archive_message', { name }), confirm: t('teacher.directory.archive'), dangerous: false }
    if (action.kind === 'restore') return { title: t('teacher.directory.restore'), message: t('teacher.directory.restore_message', { name }), confirm: t('teacher.directory.restore'), dangerous: false }
    if (action.kind === 'bulk-delete') return { title: t('teacher.bulk_delete'), message: t('teacher.bulk_delete_confirm', { count: checkedIds.value.size }), confirm: t('teacher.bulk_delete'), dangerous: true }
    const count = action.teacher?.class_count ?? 0
    return {
        title: t('teacher.delete_teacher'),
        message: count > 0 ? t('teacher.directory.delete_with_classes_message', { name, count }) : t('teacher.directory.delete_message', { name }),
        confirm: t('teacher.directory.delete_permanent'),
        dangerous: true,
    }
})
const emptyMessage = computed(() => {
    if (search.value.trim()) return t('teacher.no_search_results')
    if (status.value === 'archived') return t('teacher.directory.no_archived')
    return t('teacher.no_data')
})

async function load() {
    const sequence = ++loadSequence
    loading.value = true
    loadFailed.value = false
    try {
        const result = await TeacherDirectoryService.getPage({
            page: page.value, perPage: perPage.value, search: search.value, sort: sortField.value, descending: descending.value, status: status.value,
        })
        if (sequence !== loadSequence) return
        items.value = result.items
        statistics.value = result.statistics
        total.value = result.total
        // Keep the open detail in sync with the refreshed row.
        if (selected.value) selected.value = result.items.find(item => item.id === selected.value?.id) ?? selected.value
        await selectFromRoute()
    } catch (error) {
        if (sequence !== loadSequence) return
        loadFailed.value = true
        items.value = []
        console.warn('Teacher directory could not be loaded', error)
    } finally {
        if (sequence === loadSequence) loading.value = false
    }
}

/** Opens the teacher named in ?teacher= when it is on the current page. */
async function selectFromRoute() {
    const id = typeof route.query.teacher === 'string' ? route.query.teacher : ''
    if (!id) { selected.value = null; return }
    if (selected.value?.id === id) return
    selected.value = items.value.find(item => item.id === id) ?? null
}

function select(teacher: TeacherDirectoryItem) {
    selected.value = teacher
    void router.replace({ query: { ...route.query, teacher: teacher.id } })
}

function closeDetail() {
    selected.value = null
    const { teacher: _teacher, ...query } = route.query
    void router.replace({ query })
}

function toggle(id: string, checked: boolean) {
    const next = new Set(checkedIds.value)
    if (checked) next.add(id); else next.delete(id)
    checkedIds.value = next
}

function togglePage(checked: boolean) {
    const next = new Set(checkedIds.value)
    for (const item of items.value) { if (checked) next.add(item.id); else next.delete(item.id) }
    checkedIds.value = next
}

function openCreate() { formTeacherId.value = null; formOpen.value = true }
function openEdit() { if (selected.value) { formTeacherId.value = selected.value.id; formOpen.value = true } }

async function onSaved(teacherId: string | null) {
    formOpen.value = false
    await load()
    if (teacherId && !selected.value) {
        const created = items.value.find(item => item.id === teacherId)
        if (created) select(created)
    }
}

async function runPending() {
    const action = pending.value
    if (!action) return
    pendingBusy.value = true
    try {
        if (action.kind === 'archive' || action.kind === 'restore') {
            await TeacherDirectoryService.setArchived(action.teacher!.id, action.kind === 'archive')
            success(action.kind === 'archive' ? 'teacher.directory.archive_success' : 'teacher.directory.restore_success', { name: action.teacher!.name })
            if (status.value !== 'all') closeDetail()
        } else if (action.kind === 'delete') {
            await TeacherService.deleteTeacher(action.teacher!.id)
            success('teacher.delete_success')
            closeDetail()
        } else {
            const count = checkedIds.value.size
            await TeacherService.bulkDeleteTeachers([...checkedIds.value])
            success('teacher.bulk_delete_success', { count })
            if (selected.value && checkedIds.value.has(selected.value.id)) closeDetail()
            checkedIds.value = new Set()
        }
        pending.value = null
        await load()
    } catch (error) {
        const code = (error as { code?: string } | null)?.code
        if (code === 'TEACHER_HAS_ACTIVE_ASSIGNMENTS') errorKey('teacher.directory.archive_blocked', { name: action.teacher?.name ?? '' })
        else reportError(error, action.kind === 'delete' || action.kind === 'bulk-delete' ? 'teacher.delete_failed' : 'teacher.save_failed')
        pending.value = null
    } finally {
        pendingBusy.value = false
    }
}

function clearSearch() { search.value = '' }

watch(search, () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { page.value = 1; void load() }, 250)
})
watch([status, sortField, descending], () => { page.value = 1; checkedIds.value = new Set(); void load() })
watch([page, perPage], () => { void load() })
watch(() => route.query.teacher, () => { void selectFromRoute() })

onMounted(async () => {
    await capabilities.ensureLoaded()
    await load()
})
</script>

<template>
    <div class="space-y-5">
        <BasePageHeader :overline="t('nav.teachers')" :title="t('teacher.management_title')" :subtitle="t('teacher.management_subtitle')">
            <template #icon>
                <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600" aria-hidden="true">
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
                </div>
            </template>
            <template #actions>
                <button v-if="canCreate" type="button" class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    @click="openCreate">
                    <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14m7-7H5" /></svg>
                    {{ t('teacher.add_teacher') }}
                </button>
            </template>
        </BasePageHeader>

        <dl class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div v-for="stat in stats" :key="stat.key" class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <dt class="text-xs font-bold text-slate-500">{{ stat.label }}</dt>
                <dd class="mt-1 text-2xl font-black tabular-nums text-slate-900">{{ stat.value }}</dd>
            </div>
        </dl>

        <div class="grid gap-5" :class="selected ? 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]' : ''">
            <!-- List column; hidden on small screens while a teacher is open. -->
            <section class="min-w-0 space-y-3" :class="selected ? 'hidden lg:block' : ''" :aria-label="t('teacher.management_title')">
                <div class="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
                    <label class="relative min-w-0 flex-1">
                        <span class="sr-only">{{ t('teacher.search_label') }}</span>
                        <svg class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" /></svg>
                        <input v-model="search" type="search" autocomplete="off" class="min-h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                            :placeholder="canReadContact ? t('teacher.directory.search_placeholder_scoped') : t('teacher.name_placeholder')" />
                    </label>
                    <div class="flex gap-2">
                        <label class="min-w-0 flex-1 sm:flex-none">
                            <span class="sr-only">{{ t('teacher.directory.status_label') }}</span>
                            <select v-model="status" class="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                                <option v-for="option in statusOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                            </select>
                        </label>
                        <label class="min-w-0 flex-1 sm:flex-none">
                            <span class="sr-only">{{ t('teacher.sort_label') }}</span>
                            <select v-model="sortField" class="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">
                                <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                            </select>
                        </label>
                        <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                            :aria-label="t('teacher.directory.toggle_sort_direction')" :title="descending ? t('teacher.sort_desc') : t('teacher.sort_asc')" @click="descending = !descending">
                            <svg class="h-5 w-5 transition-transform motion-reduce:transition-none" :class="descending ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>
                        </button>
                    </div>
                </div>

                <div v-if="checkedIds.size > 0 && canDelete" class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2" role="region" :aria-label="t('teacher.directory.select_all_page')">
                    <span class="text-sm font-bold text-emerald-900">{{ t('teacher.selected_count', { count: checkedIds.size }) }}</span>
                    <div class="flex gap-2">
                        <button type="button" class="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-white" @click="checkedIds = new Set()">{{ t('teacher.clear_selection') }}</button>
                        <button type="button" class="min-h-11 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-700" @click="pending = { kind: 'bulk-delete' }">{{ t('teacher.bulk_delete') }}</button>
                    </div>
                </div>

                <div v-if="loading && items.length === 0" role="status" :aria-label="t('teacher.loading')" class="space-y-2 rounded-2xl border border-slate-200 bg-white p-3">
                    <div v-for="n in 6" :key="n" class="flex animate-pulse items-center gap-3 py-2 motion-reduce:animate-none" aria-hidden="true">
                        <div class="h-9 w-9 rounded-full bg-slate-100"></div>
                        <div class="h-4 flex-1 rounded bg-slate-100"></div>
                        <div class="hidden h-4 w-24 rounded bg-slate-100 md:block"></div>
                    </div>
                </div>
                <div v-else-if="loadFailed" role="alert" class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
                    <span class="font-bold">{{ t('teacher.directory.list_load_failed') }}</span>
                    <button type="button" class="min-h-11 rounded-xl bg-white px-4 text-sm font-bold text-rose-700 hover:bg-rose-100" @click="load">{{ t('teacher.directory.retry') }}</button>
                </div>
                <div v-else-if="items.length === 0" class="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
                    <p class="font-bold text-slate-700">{{ emptyMessage }}</p>
                    <p v-if="search.trim()" class="mt-1 text-sm text-slate-500">{{ t('teacher.directory.no_search_results_hint') }}</p>
                    <p v-else-if="status === 'active'" class="mt-1 text-sm text-slate-500">{{ t('teacher.no_data_hint') }}</p>
                    <div class="mt-4 flex justify-center gap-2">
                        <button v-if="search.trim()" type="button" class="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50" @click="clearSearch">{{ t('teacher.directory.clear_search') }}</button>
                        <button v-else-if="canCreate && status === 'active'" type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700" @click="openCreate">{{ t('teacher.add_teacher') }}</button>
                    </div>
                </div>
                <template v-else>
                    <TeacherListTable :items="items" :selected-id="selected?.id ?? null" :checked-ids="checkedIds" :selectable="canDelete"
                        :aria-busy="loading" @select="select" @toggle="toggle" @toggle-page="togglePage" />
                    <Pagination v-if="total > 0" v-model="page" v-model:per-page="perPage" :total-items="total" />
                </template>
            </section>

            <TeacherDetailPane v-if="selected" :key="selected.id" :teacher="selected" class="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)]"
                :can-edit="canUpdate" :can-archive="canArchive" :can-delete="canDelete" :can-link-account="canSensitive"
                :can-assign="canAssign" :can-read-contact="canReadContact"
                @close="closeDetail" @edit="openEdit" @link-account="linkingTeacherId = selected.id"
                @archive="pending = { kind: 'archive', teacher: selected }" @restore="pending = { kind: 'restore', teacher: selected }"
                @delete="pending = { kind: 'delete', teacher: selected }" @assignments-changed="load" />
        </div>

        <TeacherFormDialog :open="formOpen" :teacher-id="formTeacherId" :can-edit-sensitive="canSensitive"
            @close="formOpen = false" @saved="onSaved" />

        <TeacherAccountLinkDialog v-if="linkingTeacherId" :teacher-id="linkingTeacherId"
            @close="linkingTeacherId = null" @saved="load" />

        <ConfirmModal :is-open="pending !== null" :title="confirmText.title" :message="confirmText.message"
            :confirm-text="confirmText.confirm" :is-dangerous="confirmText.dangerous" :is-loading="pendingBusy"
            @confirm="runPending" @close="pending = null" />
    </div>
</template>
