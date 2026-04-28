<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import Pagination from '@/components/common/Pagination.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import {
    TeacherService,
    type TeacherDTO,
    type TeacherStatisticsDTO
} from '@/services/teacher/TeacherService'
import {
    AuthUserSearchService,
    type AuthUserSearchResultDTO
} from '@/services/Auth/AuthUserSearchService'

const { t, locale } = useI18n()
const toast = useToast()

const teachers = ref<TeacherDTO[]>([])
const loading = ref(true)
const searchQuery = ref('')
const sortField = ref<'name' | 'email' | 'created_at'>('name')
const sortDirection = ref<'asc' | 'desc'>('asc')
const pagination = ref({ page: 1, perPage: 8 })
const selectedTeacherIds = ref<Set<string>>(new Set())
const pendingDeleteCount = ref(0)

const isModalOpen = ref(false)
const isSaving = ref(false)
const editingTeacher = ref<TeacherDTO | null>(null)
const userSearchQuery = ref('')
const userSearchResults = ref<AuthUserSearchResultDTO[]>([])
const isSearchingUsers = ref(false)
const userSearchMessage = ref('')
const userSearchOnlyUnlinked = ref(true)

const form = ref<Partial<TeacherDTO>>({
    user_id: '',
    name: '',
    email: '',
    phone: '',
    birthday: '',
    gov_id: '',
    address: '',
    bio: ''
})

const confirmModal = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as (() => Promise<void>) | null
})

const filteredTeachers = computed(() => {
    const query = searchQuery.value.trim().toLowerCase()
    if (!query) return teachers.value

    return teachers.value.filter((teacher) => {
        const haystack = [
            teacher.name,
            teacher.email,
            teacher.phone,
            teacher.gov_id,
            teacher.address,
            teacher.bio,
            teacher.user_id
        ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()

        return haystack.includes(query)
    })
})

const sortedTeachers = computed(() => {
    const sorted = [...filteredTeachers.value].sort((left, right) => {
        const leftValue = String(left[sortField.value] ?? '')
        const rightValue = String(right[sortField.value] ?? '')
        const comparison = leftValue.localeCompare(rightValue, locale.value)
        return sortDirection.value === 'asc' ? comparison : -comparison
    })

    return sorted
})

const pagedTeachers = computed(() => {
    const start = (pagination.value.page - 1) * pagination.value.perPage
    const end = start + pagination.value.perPage
    return sortedTeachers.value.slice(start, end)
})

const totalPages = computed(() => Math.max(1, Math.ceil(sortedTeachers.value.length / pagination.value.perPage)))
const selectedCount = computed(() => selectedTeacherIds.value.size)
const statistics = computed<TeacherStatisticsDTO>(() => TeacherService.getTeacherStatistics(teachers.value))

const pageSelected = computed(() => {
    return pagedTeachers.value.length > 0 && pagedTeachers.value.every((teacher) => teacher.id && selectedTeacherIds.value.has(teacher.id))
})

watch(searchQuery, () => {
    pagination.value.page = 1
})

watch(sortedTeachers, () => {
    const maxPage = Math.max(1, Math.ceil(sortedTeachers.value.length / pagination.value.perPage))
    if (pagination.value.page > maxPage) {
        pagination.value.page = maxPage
    }
})

onMounted(loadTeachers)

async function loadTeachers() {
    try {
        loading.value = true
        teachers.value = await TeacherService.getAllTeachers()
        selectedTeacherIds.value = new Set()
    } catch (error) {
        console.error(error)
        toast.error(t('teacher.load_failed'))
    } finally {
        loading.value = false
    }
}

function createEmptyForm(): Partial<TeacherDTO> {
    return {
        user_id: '',
        name: '',
        email: '',
        phone: '',
        birthday: '',
        gov_id: '',
        address: '',
        bio: ''
    }
}

function openCreateModal() {
    editingTeacher.value = null
    form.value = createEmptyForm()
    resetUserSearchState()
    isModalOpen.value = true
}

function openEditModal(teacher: TeacherDTO) {
    editingTeacher.value = teacher
    form.value = {
        user_id: teacher.user_id ?? '',
        name: teacher.name ?? '',
        email: teacher.email ?? '',
        phone: teacher.phone ?? '',
        birthday: teacher.birthday ?? '',
        gov_id: teacher.gov_id ?? '',
        address: teacher.address ?? '',
        bio: teacher.bio ?? ''
    }
    resetUserSearchState()
    isModalOpen.value = true
}

function closeModal() {
    isModalOpen.value = false
    editingTeacher.value = null
    form.value = createEmptyForm()
    resetUserSearchState()
}

function resetUserSearchState() {
    userSearchQuery.value = ''
    userSearchResults.value = []
    userSearchMessage.value = ''
    isSearchingUsers.value = false
}

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUuid(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

async function searchUsersByEmail() {
    const query = userSearchQuery.value.trim()

    if (!query) {
        userSearchResults.value = []
        userSearchMessage.value = t('teacher.user_search_empty')
        return
    }

    try {
        isSearchingUsers.value = true
        userSearchMessage.value = ''
        userSearchResults.value = await AuthUserSearchService.searchUsersByEmail(query, { onlyUnlinked: userSearchOnlyUnlinked.value })

        if (userSearchResults.value.length === 0) {
            userSearchMessage.value = t('teacher.user_search_no_results', { query })
        }
    } catch (error) {
        console.error(error)
        userSearchResults.value = []
        userSearchMessage.value = (error as Error).message || t('teacher.user_search_failed')
    } finally {
        isSearchingUsers.value = false
    }
}

function applyUserSearchResult(result: AuthUserSearchResultDTO) {
    form.value.user_id = result.id
    userSearchQuery.value = result.email
    userSearchMessage.value = t('teacher.user_search_selected', { email: result.email })
}

function preparePayload(): Partial<TeacherDTO> {
    const payload: Partial<TeacherDTO> = {
        ...form.value,
        user_id: form.value.user_id?.trim() || null,
        name: form.value.name?.trim(),
        email: form.value.email?.trim(),
        phone: form.value.phone?.trim() || null,
        birthday: form.value.birthday?.toString().trim() || null,
        gov_id: form.value.gov_id?.trim() || null,
        address: form.value.address?.trim() || null,
        bio: form.value.bio?.trim() || null
    }

    return payload
}

async function saveTeacher() {
    const payload = preparePayload()

    if (!payload.name || !payload.email) {
        toast.error(t('teacher.validation_required') || 'Please fill in the required fields')
        return
    }

    if (!isValidEmail(payload.email)) {
        toast.error(t('teacher.validation_email') || 'Please enter a valid email address')
        return
    }

    if (payload.user_id && !isValidUuid(payload.user_id)) {
        toast.error(t('teacher.validation_user_id') || 'Please enter a valid UUID or leave it empty')
        return
    }

    if (payload.gov_id && payload.gov_id.length > 20) {
        toast.error(t('teacher.validation_gov_id') || 'Government ID must be 20 characters or fewer')
        return
    }

    try {
        isSaving.value = true

        if (editingTeacher.value?.id) {
            await TeacherService.updateTeacher(editingTeacher.value.id, payload)
            toast.success(t('teacher.update_success') || 'Teacher updated successfully')
        } else {
            await TeacherService.createTeacher(payload as Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>)
            toast.success(t('teacher.create_success') || 'Teacher created successfully')
        }

        await loadTeachers()
        closeModal()
    } catch (error) {
        console.error(error)
        toast.error((error as Error).message || t('teacher.save_failed') || 'Failed to save teacher')
    } finally {
        isSaving.value = false
    }
}

function openDeleteConfirm(teacher: TeacherDTO) {
    pendingDeleteCount.value = 1
    confirmModal.value = {
        isOpen: true,
        title: t('teacher.delete_teacher'),
        message: t('teacher.delete_teacher_confirm_message', { name: teacher.name }),
        confirmText: t('common.delete'),
        isDangerous: true,
        isLoading: false,
        action: async () => {
            if (!teacher.id) return
            await TeacherService.deleteTeacher(teacher.id)
        }
    }
}

function openBatchDeleteConfirm() {
    if (selectedTeacherIds.value.size === 0) return

    pendingDeleteCount.value = selectedTeacherIds.value.size

    confirmModal.value = {
        isOpen: true,
        title: t('teacher.bulk_delete'),
        message: t('teacher.bulk_delete_confirm', { count: selectedTeacherIds.value.size }),
        confirmText: t('teacher.bulk_delete'),
        isDangerous: true,
        isLoading: false,
        action: async () => {
            await TeacherService.bulkDeleteTeachers(Array.from(selectedTeacherIds.value))
        }
    }
}

async function handleConfirm() {
    if (!confirmModal.value.action) return

    try {
        confirmModal.value.isLoading = true
        await confirmModal.value.action()
        confirmModal.value.isOpen = false
        selectedTeacherIds.value = new Set()
        await loadTeachers()

        if (pendingDeleteCount.value > 1) {
            toast.success(t('teacher.bulk_delete_success', { count: pendingDeleteCount.value }))
        } else {
            toast.success(t('teacher.delete_success'))
        }
        pendingDeleteCount.value = 0
    } catch (error) {
        console.error(error)
        toast.error((error as Error).message || t('teacher.delete_failed'))
    } finally {
        confirmModal.value.isLoading = false
    }
}

function formatDate(value?: string | null) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString(locale.value === 'zh-TW' ? 'zh-TW' : 'en-US')
}

function toggleTeacherSelection(teacherId: string, checked: boolean) {
    const next = new Set(selectedTeacherIds.value)
    if (checked) {
        next.add(teacherId)
    } else {
        next.delete(teacherId)
    }
    selectedTeacherIds.value = next
}

function togglePageSelection(checked: boolean) {
    const next = new Set(selectedTeacherIds.value)
    pagedTeachers.value.forEach((teacher) => {
        if (!teacher.id) return
        if (checked) {
            next.add(teacher.id)
        } else {
            next.delete(teacher.id)
        }
    })
    selectedTeacherIds.value = next
}

function clearSelection() {
    selectedTeacherIds.value = new Set()
}

function cycleSort(field: 'name' | 'email' | 'created_at') {
    if (sortField.value === field) {
        sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
        return
    }

    sortField.value = field
    sortDirection.value = 'asc'
}
</script>

<template>
    <div class="relative min-h-screen overflow-hidden bg-slate-50">
        <div class="absolute inset-x-0 top-0 h-72 bg-gradient-to-br from-emerald-50 via-white to-cyan-50"></div>
        <div class="absolute -right-16 top-10 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl"></div>
        <div class="absolute left-0 top-40 h-56 w-56 rounded-full bg-cyan-200/30 blur-3xl"></div>

        <div class="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div class="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div class="max-w-3xl">
                    <p class="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-600">{{ t('nav.teachers') }}</p>
                    <h1 class="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
                        {{ t('teacher.management_title') }}
                    </h1>
                    <p class="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                        {{ t('teacher.management_subtitle') }}
                    </p>
                </div>

                <div class="flex flex-wrap gap-3">
                    <button
                        @click="openCreateModal"
                        class="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 hover:shadow-xl hover:shadow-emerald-600/25">
                        <span class="text-lg leading-none">+</span>
                        {{ t('teacher.add_teacher') }}
                    </button>
                    <button
                        v-if="selectedCount > 0"
                        @click="openBatchDeleteConfirm"
                        class="inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-white px-5 py-3 text-sm font-semibold text-rose-600 shadow-sm transition hover:border-rose-300 hover:bg-rose-50">
                        {{ t('teacher.bulk_delete') }} ({{ selectedCount }})
                    </button>
                </div>
            </div>

            <div class="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div class="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                    <p class="text-sm font-medium text-slate-500">{{ t('teacher.stats_total') }}</p>
                    <div class="mt-2 flex items-end justify-between">
                        <span class="text-3xl font-black text-slate-900">{{ statistics.totalTeachers }}</span>
                        <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            {{ t('teacher.stats_tracked') }}
                        </span>
                    </div>
                </div>
                <div class="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                    <p class="text-sm font-medium text-slate-500">{{ t('teacher.stats_linked') }}</p>
                    <div class="mt-2 flex items-end justify-between">
                        <span class="text-3xl font-black text-slate-900">{{ statistics.linkedAccounts }}</span>
                        <span class="rounded-full bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-700">
                            {{ t('teacher.linked_account') }}
                        </span>
                    </div>
                </div>
                <div class="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                    <p class="text-sm font-medium text-slate-500">{{ t('teacher.stats_unlinked') }}</p>
                    <div class="mt-2 flex items-end justify-between">
                        <span class="text-3xl font-black text-slate-900">{{ statistics.unlinkedAccounts }}</span>
                        <span class="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                            {{ t('teacher.unlinked_account') }}
                        </span>
                    </div>
                </div>
                <div class="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm backdrop-blur">
                    <p class="text-sm font-medium text-slate-500">{{ t('teacher.stats_complete') }}</p>
                    <div class="mt-2 flex items-end justify-between">
                        <span class="text-3xl font-black text-slate-900">{{ statistics.completeProfiles }}</span>
                        <span class="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">
                            {{ t('teacher.profile_complete') }}
                        </span>
                    </div>
                </div>
            </div>

            <div class="rounded-3xl border border-slate-200 bg-white/95 p-5 shadow-sm shadow-slate-200/60 backdrop-blur">
                <div class="grid gap-4 xl:grid-cols-[1fr_auto_auto] xl:items-end">
                    <div>
                        <label class="mb-2 block text-sm font-semibold text-slate-700">
                            {{ t('teacher.search_label') }}
                        </label>
                        <input
                            v-model="searchQuery"
                            type="text"
                            :placeholder="t('teacher.search_placeholder')"
                            class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                    </div>

                    <div>
                        <label class="mb-2 block text-sm font-semibold text-slate-700">
                            {{ t('teacher.sort_label') }}
                        </label>
                        <select
                            v-model="sortField"
                            class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100">
                            <option value="name">{{ t('teacher.sort_name') }}</option>
                            <option value="email">{{ t('teacher.sort_email') }}</option>
                            <option value="created_at">{{ t('teacher.sort_created_at') }}</option>
                        </select>
                    </div>

                    <button
                        @click="cycleSort(sortField)"
                        class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700">
                        <span v-if="sortDirection === 'asc'">↑</span>
                        <span v-else>↓</span>
                        {{ sortDirection === 'asc' ? t('teacher.sort_asc') : t('teacher.sort_desc') }}
                    </button>
                </div>

                <div v-if="selectedCount > 0" class="mt-5 flex flex-col gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        {{ t('teacher.selected_count', { count: selectedCount }) }}
                    </div>
                    <button @click="clearSelection" class="font-semibold text-emerald-700 hover:text-emerald-900">
                        {{ t('teacher.clear_selection') }}
                    </button>
                </div>
            </div>

            <div v-if="loading" class="mt-8 flex justify-center rounded-3xl border border-slate-200 bg-white/90 py-16 shadow-sm">
                <div class="flex items-center gap-3 text-slate-500">
                    <span class="h-4 w-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></span>
                    {{ t('teacher.loading') }}
                </div>
            </div>

            <div v-else-if="pagedTeachers.length > 0" class="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50">
                <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-slate-200">
                        <thead class="bg-slate-50/90">
                            <tr>
                                <th class="px-4 py-4 text-left">
                                    <input
                                        type="checkbox"
                                        :checked="pageSelected"
                                        @change="togglePageSelection(($event.target as HTMLInputElement).checked)"
                                        class="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                                </th>
                                <th class="px-4 py-4 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                                    <button class="inline-flex items-center gap-2 hover:text-emerald-700" @click="cycleSort('name')">
                                        {{ t('teacher.name_label') }}
                                    </button>
                                </th>
                                <th class="px-4 py-4 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                                    <button class="inline-flex items-center gap-2 hover:text-emerald-700" @click="cycleSort('email')">
                                        {{ t('teacher.account_label') }}
                                    </button>
                                </th>
                                <th class="px-4 py-4 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                                    {{ t('teacher.contact_label') }}
                                </th>
                                <th class="px-4 py-4 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                                    {{ t('teacher.profile_label') }}
                                </th>
                                <th class="px-4 py-4 text-left text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                                    <button class="inline-flex items-center gap-2 hover:text-emerald-700" @click="cycleSort('created_at')">
                                        {{ t('teacher.created_at_label') }}
                                    </button>
                                </th>
                                <th class="px-4 py-4 text-right text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                                    {{ t('teacher.actions') }}
                                </th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 bg-white">
                            <tr
                                v-for="teacher in pagedTeachers"
                                :key="teacher.id"
                                class="transition hover:bg-slate-50/80">
                                <td class="px-4 py-4 align-top">
                                    <input
                                        v-if="teacher.id"
                                        type="checkbox"
                                        :checked="selectedTeacherIds.has(teacher.id)"
                                        @change="toggleTeacherSelection(teacher.id, ($event.target as HTMLInputElement).checked)"
                                        class="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500" />
                                </td>
                                <td class="px-4 py-4 align-top">
                                    <div class="flex items-start gap-3">
                                        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 font-bold text-white shadow-md shadow-emerald-500/25">
                                            {{ teacher.name?.charAt(0)?.toUpperCase() || 'T' }}
                                        </div>
                                        <div class="min-w-0">
                                            <div class="font-semibold text-slate-900">{{ teacher.name }}</div>
                                            <div v-if="teacher.birthday" class="mt-1 text-sm text-slate-500">
                                                {{ t('teacher.birthday_label') }}: {{ formatDate(teacher.birthday) }}
                                            </div>
                                            <div v-if="teacher.gov_id" class="mt-1 text-sm text-slate-500">
                                                {{ t('teacher.gov_id_label') }}: {{ teacher.gov_id }}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td class="px-4 py-4 align-top">
                                    <div class="space-y-2">
                                        <div class="text-sm font-medium text-slate-900">{{ teacher.email }}</div>
                                        <span
                                            :class="teacher.user_id ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'"
                                            class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold">
                                            {{ teacher.user_id ? t('teacher.linked_account') : t('teacher.unlinked_account') }}
                                        </span>
                                    </div>
                                </td>
                                <td class="px-4 py-4 align-top text-sm text-slate-600">
                                    <div>{{ teacher.phone || '—' }}</div>
                                    <div v-if="teacher.address" class="mt-1 max-w-xs break-words text-slate-500">
                                        {{ teacher.address }}
                                    </div>
                                </td>
                                <td class="px-4 py-4 align-top text-sm text-slate-600">
                                    <div>{{ teacher.bio || '—' }}</div>
                                </td>
                                <td class="px-4 py-4 align-top text-sm text-slate-600">
                                    {{ formatDate(teacher.created_at) }}
                                </td>
                                <td class="px-4 py-4 align-top text-right">
                                    <div class="inline-flex items-center gap-2">
                                        <button
                                            @click="openEditModal(teacher)"
                                            class="rounded-xl border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50">
                                            {{ t('common.edit') }}
                                        </button>
                                        <button
                                            @click="openDeleteConfirm(teacher)"
                                            class="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-50">
                                            {{ t('common.delete') }}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div v-else class="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white/90 px-6 py-16 text-center shadow-sm">
                <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600 text-2xl font-black">
                    T
                </div>
                <h2 class="mt-6 text-xl font-bold text-slate-900">{{ t('teacher.no_data') }}</h2>
                <p class="mt-2 text-sm text-slate-500">
                    {{ searchQuery ? t('teacher.no_search_results') : t('teacher.no_data_hint') }}
                </p>
                <button
                    @click="openCreateModal"
                    class="mt-6 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700">
                    {{ t('teacher.add_teacher') }}
                </button>
            </div>

            <div v-if="!loading && totalPages > 1" class="mt-8 flex justify-center">
                <Pagination
                    :modelValue="pagination.page"
                    :perPage="pagination.perPage"
                    :totalItems="sortedTeachers.length"
                    @update:modelValue="pagination.page = $event"
                    @update:perPage="pagination.perPage = $event; pagination.page = 1" />
            </div>
        </div>

        <div
            v-if="isModalOpen"
            class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div class="w-full max-w-4xl overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-slate-950/20">
                <div class="flex items-center justify-between border-b border-slate-200 px-6 py-5">
                    <div>
                        <h2 class="text-2xl font-black text-slate-900">
                            {{ editingTeacher ? t('teacher.edit_teacher') : t('teacher.add_teacher') }}
                        </h2>
                        <p class="mt-1 text-sm text-slate-500">
                            {{ editingTeacher ? t('teacher.edit_teacher_hint') : t('teacher.add_teacher_hint') }}
                        </p>
                    </div>
                    <button @click="closeModal" class="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="max-h-[78vh] overflow-y-auto px-6 py-6">
                    <div class="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                        {{ t('teacher.user_id_hint') }}
                    </div>

                    <div class="mb-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                        <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
                            <div class="flex-1">
                                <label class="mb-2 block text-sm font-semibold text-slate-700">
                                    {{ t('teacher.user_search_label') }}
                                </label>
                                <input
                                    v-model="userSearchQuery"
                                    type="email"
                                    :placeholder="t('teacher.user_search_placeholder')"
                                    class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                                    @keydown.enter.prevent="searchUsersByEmail" />
                            </div>
                            <div class="flex items-center gap-3">
                                <label class="inline-flex items-center gap-2 text-sm text-slate-700">
                                    <input type="checkbox" v-model="userSearchOnlyUnlinked" class="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                                    <span>{{ t('teacher.filter_unlinked') }}</span>
                                </label>

                                <button
                                    @click="searchUsersByEmail"
                                    :disabled="isSearchingUsers"
                                    class="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                                    <span v-if="isSearchingUsers" class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                                    {{ isSearchingUsers ? t('teacher.user_search_loading') : t('teacher.user_search_button') }}
                                </button>
                            </div>
                        </div>

                        <p class="mt-2 text-sm text-slate-500">
                            {{ t('teacher.user_search_hint') }}
                        </p>

                        <p v-if="userSearchMessage" class="mt-3 text-sm text-slate-600">
                            {{ userSearchMessage }}
                        </p>

                        <div v-if="userSearchResults.length > 0" class="mt-4 space-y-2">
                            <div
                                v-for="result in userSearchResults"
                                :key="result.id"
                                class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div class="text-sm font-semibold text-slate-900">{{ result.email }}</div>
                                    <div class="mt-1 text-xs text-slate-500 break-all">
                                        {{ result.id }}
                                    </div>
                                </div>
                                <button
                                    @click="applyUserSearchResult(result)"
                                    class="inline-flex items-center justify-center rounded-xl border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-50">
                                    {{ t('teacher.user_search_select') }}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="grid gap-5 md:grid-cols-2">
                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.user_id_label') }}
                            </label>
                            <input
                                v-model="form.user_id"
                                type="text"
                                :placeholder="t('teacher.user_id_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.name_label') }} <span class="text-rose-500">*</span>
                            </label>
                            <input
                                v-model="form.name"
                                type="text"
                                :placeholder="t('teacher.name_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.email_label') }} <span class="text-rose-500">*</span>
                            </label>
                            <input
                                v-model="form.email"
                                type="email"
                                :placeholder="t('teacher.email_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.phone_label') }}
                            </label>
                            <input
                                v-model="form.phone"
                                type="tel"
                                :placeholder="t('teacher.phone_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.birthday_label') }}
                            </label>
                            <input
                                v-model="form.birthday"
                                type="date"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.gov_id_label') }}
                            </label>
                            <input
                                v-model="form.gov_id"
                                type="text"
                                maxlength="20"
                                :placeholder="t('teacher.gov_id_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div class="md:col-span-2">
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.address_label') }}
                            </label>
                            <input
                                v-model="form.address"
                                type="text"
                                :placeholder="t('teacher.address_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div class="md:col-span-2">
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.bio_label') }}
                            </label>
                            <textarea
                                v-model="form.bio"
                                rows="4"
                                :placeholder="t('teacher.bio_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"></textarea>
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5">
                    <button
                        @click="closeModal"
                        class="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                        {{ t('common.cancel') }}
                    </button>
                    <button
                        @click="saveTeacher"
                        :disabled="isSaving"
                        class="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                        <span v-if="isSaving" class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                        {{ isSaving ? t('common.saving') : t('common.save') }}
                    </button>
                </div>
            </div>
        </div>

        <ConfirmModal
            :is-open="confirmModal.isOpen"
            :title="confirmModal.title"
            :message="confirmModal.message"
            :confirm-text="confirmModal.confirmText"
            :is-dangerous="confirmModal.isDangerous"
            :is-loading="confirmModal.isLoading"
            @confirm="handleConfirm"
            @close="confirmModal.isOpen = false" />
    </div>
</template>