<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import Pagination from '@/components/common/Pagination.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import TeacherAccountLinkDialog from '@/components/teacher/TeacherAccountLinkDialog.vue'
import {
    TeacherService,
    type TeacherCredentialDTO,
    type TeacherDTO,
    type TeacherStatisticsDTO
} from '@/services/teacher/TeacherService'
import { PageApiService } from '@/services/api/PageApiService'
import type { TeacherOverviewDTO } from '@/services/api/PageApiService'
import {
    AuthUserSearchService,
    type AuthUserSearchResultDTO
} from '@/services/auth/AuthUserSearchService'

import BaseDropdown from '@/components/common/BaseDropdown.vue'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import TextEditor from '@/components/common/text-editor/TextEditor.vue'
import RichTextViewer from '@/components/common/text-editor/RichTextViewer.vue'
import { createTextEditorContent } from '@/components/common/text-editor/content'
import type { TextEditorContent } from '@/components/common/text-editor/types'
import { isKodingPlatform, KODING_PLATFORM } from '@/utils/koding'

const { t } = useI18n()
const toast = useToast()
const { errorKey, reportError } = useFeedback()

const teachers = ref<TeacherOverviewDTO[]>([])
const statistics = ref<TeacherStatisticsDTO>({ totalTeachers: 0, linkedAccounts: 0, unlinkedAccounts: 0, completeProfiles: 0, teachersWithBirthday: 0, teachersWithGovId: 0 })
const loading = ref(true)
const searchQuery = ref('')
const sortField = ref<'name' | 'created_at'>('name')
const sortDirection = ref<'asc' | 'desc'>('asc')
const pagination = ref({ page: 1, perPage: 8, total: 0 })
const selectedTeacherIds = ref<Set<string>>(new Set())
const pendingDeleteCount = ref(0)

const sortOptions = computed(() => [
    { label: t('teacher.sort_name'), value: 'name' },
    { label: t('teacher.sort_created_at'), value: 'created_at' }
])

const isModalOpen = ref(false)
const isSaving = ref(false)
const isCredentialSaving = ref(false)
const editingTeacher = ref<TeacherDTO | null>(null)
const linkingTeacher = ref<TeacherDTO | null>(null)
const userSearchQuery = ref('')
const userSearchResults = ref<AuthUserSearchResultDTO[]>([])
const isSearchingUsers = ref(false)
const userSearchMessage = ref('')
const userSearchOnlyUnlinked = ref(true)
const isAddCredentialFormOpen = ref(false)

const form = ref<Partial<TeacherDTO>>({
    user_id: '',
    name: '',
    email: '',
    phone: '',
    birthday: '',
    gov_id: '',
    address: '',
    bio: '',
    bio_document: createTextEditorContent('').richText
})
const teacherBioContent = computed<TextEditorContent>({
    get: () => createTextEditorContent(form.value.bio_document || form.value.bio || ''),
    set: (content) => {
        form.value.bio = content.plainText
        form.value.bio_document = content.richText
    }
})
type EditableTeacherCredential = TeacherCredentialDTO & {
    platformSelection: string
    customPlatform: string
}

const platformOptions = computed(() => [
    { label: t('teacher.credentials_platforms.koding_school_orange_apple'), value: KODING_PLATFORM },
    { label: t('teacher.credentials_platforms.Roblox'), value: 'Roblox' },
    { label: t('teacher.credentials_platforms.Minecraft'), value: 'Minecraft' },
    { label: t('teacher.credentials_platforms.Anydesk'), value: 'Anydesk' },
    { label: t('teacher.credentials_platforms.Quiz Platform'), value: 'Quiz Platform' },
    { label: t('teacher.credentials_platforms.Discord'), value: 'Discord' },
    { label: t('teacher.credentials_platforms.Other'), value: 'Other' }
])
const predefinedPlatformValues = computed(() => platformOptions.value
    .map(option => option.value)
    .filter(value => value !== 'Other'))
const newCredential = ref({ platform: '', customPlatform: '', username: '', password: '', url: '' })
const editingCredentials = ref<EditableTeacherCredential[]>([])

const confirmModal = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as (() => Promise<void>) | null
})

const pagedTeachers = computed(() => teachers.value)

const selectedCount = computed(() => selectedTeacherIds.value.size)
let searchTimeout: ReturnType<typeof setTimeout> | undefined
watch(searchQuery, () => {
    if (searchTimeout) clearTimeout(searchTimeout)
    pagination.value.page = 1
    searchTimeout = setTimeout(() => { void loadTeachers() }, 250)
})

watch(() => [pagination.value.page, pagination.value.perPage], () => { void loadTeachers() })

onMounted(loadTeachers)

async function loadTeachers() {
    try {
        loading.value = true
        const response = await PageApiService.getTeachersOverview({
            limit: pagination.value.perPage,
            offset: (pagination.value.page - 1) * pagination.value.perPage,
            search: searchQuery.value,
            sort: `${sortDirection.value === 'desc' ? '-' : ''}${sortField.value}`,
        })
        teachers.value = response.data.teachers
        statistics.value = response.data.statistics
        pagination.value.total = Number(response.meta?.total ?? teachers.value.length)
        selectedTeacherIds.value = new Set()
    } catch (error) {
        console.error(error)
        reportError(error, 'teacher.load_failed')
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
        bio: '',
        bio_document: createTextEditorContent('').richText
    }
}

function openCreateModal() {
    editingTeacher.value = null
    form.value = createEmptyForm()
    editingCredentials.value = []
    newCredential.value = createEmptyCredentialForm()
    isAddCredentialFormOpen.value = false
    resetUserSearchState()
    isModalOpen.value = true
}

async function openEditModal(teacher: TeacherOverviewDTO) {
    try {
    if (!teacher.id) throw new Error('Teacher id is required')
    const detail = await TeacherService.getTeacherById(teacher.id)
    editingTeacher.value = detail
    form.value = {
        user_id: detail.user_id ?? '',
        name: detail.name ?? '',
        email: detail.email ?? '',
        phone: detail.phone ?? '',
        birthday: detail.birthday ?? '',
        gov_id: detail.gov_id ?? '',
        address: detail.address ?? '',
        bio: detail.bio ?? '',
        bio_document: detail.bio_document || createTextEditorContent(detail.bio || '').richText
    }
    editingCredentials.value = getTeacherCredentials(detail).map(toEditableCredential)
    newCredential.value = createEmptyCredentialForm()
    isAddCredentialFormOpen.value = false
    resetUserSearchState()
    isModalOpen.value = true
    } catch (error) {
        console.error(error)
        reportError(error, 'teacher.load_failed')
    }
}

function openAccountLinkDialog() {
    if (editingTeacher.value?.id) linkingTeacher.value = editingTeacher.value
}

function closeModal() {
    isModalOpen.value = false
    editingTeacher.value = null
    form.value = createEmptyForm()
    editingCredentials.value = []
    newCredential.value = createEmptyCredentialForm()
    isAddCredentialFormOpen.value = false
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
        email: form.value.email?.trim() || null,
        phone: form.value.phone?.trim() || null,
        birthday: form.value.birthday?.toString().trim() || null,
        gov_id: form.value.gov_id?.trim() || null,
        address: form.value.address?.trim() || null,
        bio: teacherBioContent.value.plainText || null,
        bio_document: teacherBioContent.value.richText
    }

    return payload
}

async function saveTeacher() {
    const payload = preparePayload()

    if (!payload.name) {
        errorKey('teacher.validation_required')
        return
    }

    if (payload.email && !isValidEmail(payload.email)) {
        errorKey('teacher.validation_email')
        return
    }

    if (payload.user_id && !isValidUuid(payload.user_id)) {
        errorKey('teacher.validation_user_id')
        return
    }

    if (payload.gov_id && payload.gov_id.length > 20) {
        errorKey('teacher.validation_gov_id')
        return
    }

    try {
        isSaving.value = true

        if (editingTeacher.value?.id) {
            const { user_id: _unchangedAccountLink, ...profileUpdates } = payload
            await TeacherService.updateTeacher(editingTeacher.value.id, profileUpdates)
            toast.success(t('teacher.update_success'))
        } else {
            await TeacherService.createTeacher(payload as Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>)
            toast.success(t('teacher.create_success'))
        }

        await loadTeachers()
        closeModal()
    } catch (error: any) {
        console.error(error)
        if (String(error?.message ?? '').includes('teachers_user_id_key')) errorKey('teacher.error_duplicate_user')
        else reportError(error, 'teacher.save_failed')
    } finally {
        isSaving.value = false
    }
}

function openDeleteConfirm(teacher: TeacherOverviewDTO) {
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
        reportError(error, 'teacher.delete_failed')
    } finally {
        confirmModal.value.isLoading = false
    }
}

function toggleTeacherSelection(teacherId: string | undefined, checked: boolean) {
    if (!teacherId) return
    const next = new Set(selectedTeacherIds.value)
    if (checked) {
        next.add(teacherId)
    } else {
        next.delete(teacherId)
    }
    selectedTeacherIds.value = next
}

function clearSelection() {
    selectedTeacherIds.value = new Set()
}

function cycleSort(field: 'name' | 'created_at') {
    if (sortField.value === field) {
        sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
        void loadTeachers()
        return
    }

    sortField.value = field
    sortDirection.value = 'asc'
    void loadTeachers()
}

function createEmptyCredentialForm() {
    return {
        platform: '',
        customPlatform: '',
        username: '',
        password: '',
        url: ''
    }
}

function closeAddCredentialForm() {
    isAddCredentialFormOpen.value = false
    newCredential.value = createEmptyCredentialForm()
}

function getTeacherCredentials(teacher: TeacherDTO | null): TeacherCredentialDTO[] {
    return teacher?.teacher_credentials || []
}

function getPlatformSelection(platform: string | undefined) {
    if (!platform) return ''
    if (isKodingPlatform(platform)) return KODING_PLATFORM
    return predefinedPlatformValues.value.includes(platform) ? platform : 'Other'
}

function toEditableCredential(credential: TeacherCredentialDTO): EditableTeacherCredential {
    const platformSelection = getPlatformSelection(credential.platform)

    return {
        ...credential,
        platformSelection,
        customPlatform: platformSelection === 'Other' ? credential.platform : ''
    }
}

function resolvePlatform(platformSelection: string, customPlatform: string) {
    return platformSelection === 'Other' ? customPlatform.trim() : platformSelection
}

function validateCredentialInput(platform: string, username: string, password: string) {
    if (!platform || !username || (!isKodingPlatform(platform) && !password)) {
        errorKey('teacher.credentials_platform_required')
        return false
    }

    return true
}

async function refreshEditingTeacher() {
    if (!editingTeacher.value?.id) return
    const teacher = await TeacherService.getTeacherById(editingTeacher.value.id)
    editingTeacher.value = teacher
    editingCredentials.value = getTeacherCredentials(teacher).map(toEditableCredential)
}

async function addTeacherCredential() {
    if (!editingTeacher.value?.id) {
        errorKey('teacher.credentials_save_teacher_first')
        return
    }

    const platform = resolvePlatform(newCredential.value.platform, newCredential.value.customPlatform)
    const username = newCredential.value.username.trim()
    const password = newCredential.value.password.trim()
    if (!validateCredentialInput(platform, username, password)) {
        return
    }

    try {
        isCredentialSaving.value = true
        await TeacherService.addCredential({
            teacher_id: editingTeacher.value.id,
            platform,
            username,
            password,
            url: newCredential.value.url.trim()
        })
        newCredential.value = createEmptyCredentialForm()
        isAddCredentialFormOpen.value = false
        await loadTeachers()
        await refreshEditingTeacher()
        toast.success(t('teacher.credentials_add_success'))
    } catch (error: any) {
        console.error(error)
        reportError(error, 'teacher.credentials_save_failed')
    } finally {
        isCredentialSaving.value = false
    }
}

async function updateTeacherCredential(credential: EditableTeacherCredential) {
    if (!credential.id) return

    const platform = resolvePlatform(credential.platformSelection, credential.customPlatform)
    const username = credential.username?.trim() || ''
    const password = credential.password?.trim() || ''
    if (!validateCredentialInput(platform, username, password)) {
        return
    }

    try {
        isCredentialSaving.value = true
        await TeacherService.updateCredential(credential.id, {
            platform,
            username,
            password,
            url: credential.url?.trim() || ''
        })
        await loadTeachers()
        await refreshEditingTeacher()
        toast.success(t('teacher.credentials_update_success'))
    } catch (error: any) {
        console.error(error)
        reportError(error, 'teacher.credentials_save_failed')
    } finally {
        isCredentialSaving.value = false
    }
}

async function deleteTeacherCredential(credential: TeacherCredentialDTO) {
    if (!credential.id) return

    try {
        isCredentialSaving.value = true
        await TeacherService.deleteCredential(credential.id)
        editingCredentials.value = editingCredentials.value.filter(item => item.id !== credential.id)
        await loadTeachers()
        toast.success(t('teacher.credentials_delete_success'))
    } catch (error: any) {
        console.error(error)
        reportError(error, 'teacher.credentials_save_failed')
    } finally {
        isCredentialSaving.value = false
    }
}
</script>
<template>
    <div class="space-y-6">
        <BasePageHeader :overline="t('nav.teachers')" :title="t('teacher.management_title')"
            :subtitle="t('teacher.management_subtitle')">
            <template #icon>
                <div
                    class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path d="M12 14l9-5-9-5-9 5 9 5z" />
                        <path
                            d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                    </svg>
                </div>
            </template>
            <template #actions>
                <div class="flex flex-col sm:flex-row flex-1 items-center gap-4 w-full max-w-4xl">
                    <!-- Search Bar -->
                    <div
                        class="w-full flex-1 flex items-center gap-4 bg-white/50 p-1.5 rounded-2xl border border-gray-100 shadow-sm group focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-500/5 transition-all">
                        <div class="pl-3 text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input v-model="searchQuery" type="text" :placeholder="t('teacher.search_placeholder')"
                            class="flex-1 bg-transparent border-none outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300 py-2 min-w-0" />
                        <button v-if="searchQuery" @click="searchQuery = ''"
                            class="p-2 text-gray-300 hover:text-gray-500 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <!-- Sort Dropdown -->
                    <div class="flex items-center gap-2 shrink-0">
                        <BaseDropdown v-model="sortField" :options="sortOptions" theme="emerald"
                            class="min-w-[140px]" />
                        <button @click="cycleSort(sortField)"
                            class="p-3 rounded-xl bg-white border border-gray-100 shadow-sm text-gray-500 hover:text-emerald-600 transition-colors active:scale-95">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 transition-transform duration-300"
                                :class="{ 'rotate-180': sortDirection === 'desc' }" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Add Button -->
                <button @click="openCreateModal"
                    class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl transition-all shadow-lg shadow-emerald-200 font-black flex items-center justify-center gap-2 active:scale-95 text-sm uppercase tracking-widest shrink-0 w-full lg:w-auto">
                    <span class="text-xl leading-none">+</span> {{ t('teacher.add_teacher') }}
                </button>
            </template>
        </BasePageHeader>

        <!-- Stats Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div v-for="(stat, key) in [
                { label: t('teacher.stats_total'), value: statistics.totalTeachers, color: 'emerald', icon: 'M17 20h5v-1a7 7 0 00-7-7h-1m-6 8h12m-6-8a4 4 0 100-8 4 4 0 000 8zm-5 8a7 7 0 0114 0v1H6v-1z' },
                { label: t('teacher.stats_linked'), value: statistics.linkedAccounts, color: 'cyan', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
                { label: t('teacher.stats_unlinked'), value: statistics.unlinkedAccounts, color: 'amber', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
                { label: t('teacher.stats_complete'), value: statistics.completeProfiles, color: 'violet', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' }
            ]" :key="key"
                class="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl p-4 shadow-sm group hover:shadow-md transition-all">
                <div class="flex items-center gap-3">
                    <div
                        :class="`w-10 h-10 rounded-xl bg-${stat.color}-50 text-${stat.color}-600 flex items-center justify-center shrink-0 transition-transform group-hover:scale-110`">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="stat.icon" />
                        </svg>
                    </div>
                    <div>
                        <p class="text-[14px] font-black uppercase tracking-widest text-gray-400 leading-none mb-1.5">{{
                            stat.label }}</p>
                        <p class="text-xl font-black text-gray-900 leading-none">{{ stat.value }}</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Bulk Actions Bar -->
        <Transition enter-active-class="transition duration-300 ease-out"
            enter-from-class="transform -translate-y-4 opacity-0" enter-to-class="transform translate-y-0 opacity-100"
            leave-active-class="transition duration-200 ease-in" leave-from-class="transform translate-y-0 opacity-100"
            leave-to-class="transform -translate-y-4 opacity-0">
            <div v-if="selectedCount > 0"
                class="bg-emerald-600 rounded-2xl p-4 shadow-lg shadow-emerald-200 flex items-center justify-between text-white">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center font-black">
                        {{ selectedCount }}
                    </div>
                    <span class="font-bold text-sm uppercase tracking-widest">{{ t('teacher.selected_count', {
                        count:
                            selectedCount
                    }) }}</span>
                </div>
                <div class="flex items-center gap-3">
                    <button @click="clearSelection"
                        class="px-4 py-2 rounded-xl hover:bg-white/10 transition font-bold text-sm">
                        {{ t('teacher.clear_selection') }}
                    </button>
                    <button @click="openBatchDeleteConfirm"
                        class="bg-white text-emerald-600 px-6 py-2 rounded-xl font-black text-sm hover:bg-emerald-50 transition active:scale-95 shadow-sm uppercase tracking-widest">
                        {{ t('teacher.bulk_delete') }}
                    </button>
                </div>
            </div>
        </Transition>

        <!-- Main Content Grid -->
        <div v-if="loading" class="text-center py-20 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <svg class="animate-spin h-10 w-10 mx-auto mb-4 text-emerald-500" xmlns="http://www.w3.org/2000/svg"
                fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            <p class="text-gray-500 font-medium">{{ t('common.loading') }}...</p>
        </div>

        <div v-else-if="pagedTeachers.length > 0" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div v-for="teacher in pagedTeachers" :key="teacher.id"
                class="bg-white rounded-3xl shadow-sm border border-gray-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group overflow-hidden flex flex-col h-full relative">

                <!-- Selection Checkbox -->
                <div class="absolute top-4 left-4 z-10">
                    <input type="checkbox" :checked="teacher.id ? selectedTeacherIds.has(teacher.id) : false"
                        @change="toggleTeacherSelection(teacher.id, ($event.target as HTMLInputElement).checked)"
                        class="h-5 w-5 rounded-lg border-gray-200 text-emerald-600 focus:ring-emerald-500 transition-all cursor-pointer shadow-sm" />
                </div>

                <!-- Card Header/Avatar -->
                <div class="p-6 pb-0 flex flex-col items-center text-center">
                    <div class="relative mb-4">
                        <div
                            class="w-20 h-20 rounded-[2rem] bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-3xl font-black text-white shadow-xl shadow-emerald-200 group-hover:scale-110 transition-transform duration-500">
                            {{ teacher.name?.charAt(0)?.toUpperCase() || 'T' }}
                        </div>
                        <div v-if="teacher.user_id"
                            class="absolute -bottom-1 -right-1 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md border border-emerald-50 text-emerald-500"
                            :title="t('teacher.linked_account')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                fill="currentColor">
                                <path fill-rule="evenodd"
                                    d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                    clip-rule="evenodd" />
                            </svg>
                        </div>
                    </div>
                    <h3
                        class="text-xl font-black text-gray-900 line-clamp-1 group-hover:text-emerald-600 transition-colors">
                        {{
                            teacher.name }}</h3>
                    <p class="text-sm font-bold text-gray-400 mt-1 uppercase tracking-widest">{{ teacher.user_id ?
                        t('teacher.linked_account') : t('teacher.unlinked_account') }}</p>
                </div>

                <!-- Info Body -->
                <div class="p-6 flex-1 space-y-4">
                    <div class="flex flex-col gap-2.5">
                        <div
                            class="flex items-center gap-3 text-sm text-gray-600 bg-gray-50/80 p-2 rounded-xl border border-gray-100/50">
                            <div
                                class="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-500" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <span class="truncate font-medium">{{ teacher.email }}</span>
                        </div>
                        <div v-if="teacher.phone"
                            class="flex items-center gap-3 text-sm text-gray-600 bg-gray-50/80 p-2 rounded-xl border border-gray-100/50">
                            <div
                                class="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-500" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                            </div>
                            <span class="truncate font-medium">{{ teacher.phone }}</span>
                        </div>
                    </div>

                    <RichTextViewer v-if="teacher.bio" :content="{ plainText: teacher.bio, richText: teacher.bio_document || createTextEditorContent(teacher.bio).richText }"
                        preset="notes" :min-height="0" class="text-xs text-gray-500" />
                </div>

                <!-- Action Footer -->
                <div class="p-4 bg-gray-50/50 border-t border-gray-100 flex items-center gap-2">
                    <button @click="openEditModal(teacher)"
                        class="flex-1 bg-white hover:bg-emerald-50 text-emerald-600 border border-emerald-100 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                        </svg>
                        {{ t('common.edit') }}
                    </button>
                    <button @click="openDeleteConfirm(teacher)"
                        class="p-2.5 bg-white hover:bg-rose-50 text-rose-400 hover:text-rose-600 border border-gray-100 hover:border-rose-100 rounded-xl transition-all shadow-sm active:scale-95">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>

        <div v-else
            class="mt-8 rounded-[3rem] border-4 border-dashed border-gray-100 bg-white py-20 text-center shadow-inner">
            <div class="mx-auto w-24 h-24 bg-gray-50 rounded-[2.5rem] flex items-center justify-center mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-gray-200" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M17 20h5v-1a7 7 0 00-7-7h-1m-6 8h12m-6-8a4 4 0 100-8 4 4 0 000 8zm-5 8a7 7 0 0114 0v1H6v-1z" />
                </svg>
            </div>
            <h2 class="text-2xl font-black text-gray-900 uppercase tracking-tight">{{ t('teacher.no_data') }}</h2>
            <p class="mt-2 text-gray-400 font-medium max-w-sm mx-auto">
                {{ searchQuery ? t('teacher.no_search_results') : t('teacher.no_data_hint') }}
            </p>
            <button @click="openCreateModal"
                class="mt-8 bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-4 rounded-2xl transition-all shadow-xl shadow-emerald-200 font-black uppercase tracking-widest active:scale-95">
                {{ t('teacher.add_teacher') }}
            </button>
        </div>

        <div v-if="!loading && pagination.total > 0" class="mt-12 flex justify-center pb-12">
            <Pagination :modelValue="pagination.page" :perPage="pagination.perPage" :totalItems="pagination.total"
                @update:modelValue="pagination.page = $event"
                @update:perPage="pagination.perPage = $event; pagination.page = 1" />
        </div>

        <!-- Modals and Tooltips -->
        <ConfirmModal :is-open="confirmModal.isOpen" :title="confirmModal.title" :message="confirmModal.message"
            :confirm-text="confirmModal.confirmText" :is-dangerous="confirmModal.isDangerous"
            :is-loading="confirmModal.isLoading" @confirm="handleConfirm" @close="confirmModal.isOpen = false" />

        <div v-if="isModalOpen"
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
                    <button @click="closeModal"
                        class="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="max-h-[78vh] overflow-y-auto px-6 py-6">
                    <div
                        class="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                        {{ t('teacher.user_id_hint') }}
                    </div>

                    <div class="mb-6 rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                        <div class="flex flex-col gap-3 lg:flex-row lg:items-end">
                            <div class="flex-1">
                                <label class="mb-2 block text-sm font-semibold text-slate-700">
                                    {{ t('teacher.user_search_label') }}
                                </label>
                                <input v-model="userSearchQuery" type="email"
                                    :placeholder="t('teacher.user_search_placeholder')"
                                    class="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100"
                                    @keydown.enter.prevent="searchUsersByEmail" />
                            </div>
                            <div class="flex items-center gap-3">
                                <label class="inline-flex items-center gap-2 text-sm text-slate-700">
                                    <input type="checkbox" v-model="userSearchOnlyUnlinked"
                                        class="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                                    <span>{{ t('teacher.filter_unlinked') }}</span>
                                </label>

                                <button @click="searchUsersByEmail" :disabled="isSearchingUsers"
                                    class="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                                    <span v-if="isSearchingUsers"
                                        class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                                    {{ isSearchingUsers ? t('teacher.user_search_loading') :
                                        t('teacher.user_search_button') }}
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
                            <div v-for="result in userSearchResults" :key="result.id"
                                class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <div class="text-sm font-semibold text-slate-900">{{ result.email }}</div>
                                    <div class="mt-1 text-xs text-slate-500 break-all">
                                        {{ result.id }}
                                    </div>
                                </div>
                                <button @click="applyUserSearchResult(result)"
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
                            <input v-model="form.user_id" type="text" :placeholder="t('teacher.user_id_placeholder')" :disabled="!!editingTeacher"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                            <div v-if="editingTeacher?.id" class="mt-2 flex flex-wrap items-center gap-2">
                                <p class="text-xs font-medium text-amber-700">{{ t('teacher.account_link_locked') }}</p>
                                <button type="button" class="rounded-lg border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50" @click="openAccountLinkDialog">
                                    {{ t('teacher.manage_account_link') }}
                                </button>
                            </div>
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.name_label') }} <span class="text-rose-500">*</span>
                            </label>
                            <input v-model="form.name" type="text" :placeholder="t('teacher.name_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.email_label') }} <span class="text-rose-500">*</span>
                            </label>
                            <input v-model="form.email" type="email" :placeholder="t('teacher.email_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.phone_label') }}
                            </label>
                            <input v-model="form.phone" type="tel" :placeholder="t('teacher.phone_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.birthday_label') }}
                            </label>
                            <input v-model="form.birthday" type="date"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div>
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.gov_id_label') }}
                            </label>
                            <input v-model="form.gov_id" type="text" maxlength="20"
                                :placeholder="t('teacher.gov_id_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div class="md:col-span-2">
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.address_label') }}
                            </label>
                            <input v-model="form.address" type="text" :placeholder="t('teacher.address_placeholder')"
                                class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                        </div>

                        <div class="md:col-span-2">
                            <label class="mb-2 block text-sm font-semibold text-slate-700">
                                {{ t('teacher.bio_label') }}
                            </label>
                            <TextEditor v-model="teacherBioContent" preset="form" :min-height="112"
                                :placeholder="t('teacher.bio_placeholder')" />
                        </div>
                    </div>

                    <div v-if="editingTeacher" class="mt-6 rounded-3xl border border-emerald-100 bg-emerald-50/40 p-5">
                        <div class="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <h3 class="text-base font-black text-slate-900">{{ t('teacher.credentials_title') }}</h3>
                                <p class="mt-1 text-sm text-slate-500">{{ t('teacher.credentials_hint') }}</p>
                            </div>
                            <span class="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700">
                                {{ editingCredentials.length }}
                            </span>
                        </div>

                        <div v-if="editingCredentials.length > 0" class="space-y-3">
                            <div v-for="credential in editingCredentials" :key="credential.id"
                                class="space-y-4 rounded-2xl border border-emerald-100 bg-white p-4">
                                <div class="grid gap-3 md:grid-cols-2">
                                    <div>
                                        <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                            {{ t('teacher.credentials_platform') }}
                                        </label>
                                        <BaseDropdown v-model="credential.platformSelection" :options="platformOptions"
                                            theme="emerald" />
                                    </div>
                                    <div v-if="credential.platformSelection === 'Other'">
                                        <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                            {{ t('teacher.credentials_platform_name') }}
                                        </label>
                                        <input v-model="credential.customPlatform" type="text"
                                            :placeholder="t('teacher.credentials_platform_name')"
                                            class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                                    </div>
                                </div>

                                <div class="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                                    <div>
                                        <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                            {{ t('teacher.credentials_username') }}
                                        </label>
                                        <input v-model="credential.username" type="text"
                                            class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                                    </div>
                                    <div>
                                        <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                            {{ t('teacher.credentials_password') }}
                                        </label>
                                        <input v-model="credential.password" type="text"
                                            class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                                    </div>
                                    <div>
                                        <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                            {{ t('teacher.credentials_url') }}
                                        </label>
                                        <input v-model="credential.url" type="url"
                                            class="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100" />
                                    </div>
                                    <div class="flex gap-2">
                                        <button @click="updateTeacherCredential(credential)" :disabled="isCredentialSaving"
                                            class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                                            {{ t('common.save') }}
                                        </button>
                                        <button @click="deleteTeacherCredential(credential)" :disabled="isCredentialSaving"
                                            class="rounded-xl border border-rose-100 bg-white px-3 py-2 text-sm font-bold text-rose-500 transition hover:bg-rose-50 disabled:opacity-50">
                                            {{ t('common.delete') }}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div v-else class="rounded-2xl border border-dashed border-emerald-200 bg-white/70 px-4 py-5 text-center text-sm font-semibold text-slate-400">
                            {{ t('teacher.credentials_empty') }}
                        </div>

                        <button type="button" data-testid="teacher-credential-add-toggle"
                            @click="isAddCredentialFormOpen = !isAddCredentialFormOpen"
                            class="mt-4 flex w-full items-center justify-between rounded-2xl border border-dashed border-emerald-200 bg-white/80 px-4 py-3 text-left text-sm font-black text-emerald-700 transition hover:border-emerald-300 hover:bg-white">
                            <span>{{ t('teacher.credentials_add') }}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
                                :class="{ 'rotate-180': isAddCredentialFormOpen }" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor" stroke-width="2">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
                            </svg>
                        </button>

                        <div v-if="isAddCredentialFormOpen" data-testid="teacher-credential-add-form"
                            class="mt-3 space-y-4 rounded-2xl border border-dashed border-emerald-200 bg-white/80 p-4">
                            <div class="grid gap-3 md:grid-cols-2">
                                <div>
                                    <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                        {{ t('teacher.credentials_platform') }}
                                    </label>
                                    <BaseDropdown v-model="newCredential.platform" :options="platformOptions"
                                        theme="emerald" :placeholder="t('teacher.credentials_platform')" />
                                </div>
                                <div v-if="newCredential.platform === 'Other'">
                                    <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                        {{ t('teacher.credentials_platform_name') }}
                                    </label>
                                    <input v-model="newCredential.customPlatform" type="text"
                                        :placeholder="t('teacher.credentials_platform_name')"
                                        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                                </div>
                            </div>

                            <div class="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
                                <div>
                                    <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                        {{ t('teacher.credentials_username') }}
                                    </label>
                                    <input v-model="newCredential.username" type="text"
                                        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                                </div>
                                <div>
                                    <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                        {{ t('teacher.credentials_password') }}
                                    </label>
                                    <input v-model="newCredential.password" type="text"
                                        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                                </div>
                                <div>
                                    <label class="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">
                                        {{ t('teacher.credentials_url') }}
                                    </label>
                                    <input v-model="newCredential.url" type="url"
                                        class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-100" />
                                </div>
                                <div class="flex gap-2">
                                    <button @click="closeAddCredentialForm" :disabled="isCredentialSaving"
                                        class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50">
                                        {{ t('common.cancel') }}
                                    </button>
                                    <button @click="addTeacherCredential" :disabled="isCredentialSaving"
                                        class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50">
                                        {{ t('teacher.credentials_add') }}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-5">
                    <button @click="closeModal"
                        class="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                        {{ t('common.cancel') }}
                    </button>
                    <button @click="saveTeacher" :disabled="isSaving"
                        class="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">
                        <span v-if="isSaving"
                            class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                        {{ isSaving ? t('common.saving') : t('common.save') }}
                    </button>
                </div>
            </div>
        </div>

        <TeacherAccountLinkDialog
            v-if="linkingTeacher?.id"
            :teacher-id="linkingTeacher.id"
            @close="linkingTeacher = null"
            @saved="loadTeachers"
        />

        <ConfirmModal :is-open="confirmModal.isOpen" :title="confirmModal.title" :message="confirmModal.message"
            :confirm-text="confirmModal.confirmText" :is-dangerous="confirmModal.isDangerous"
            :is-loading="confirmModal.isLoading" @confirm="handleConfirm" @close="confirmModal.isOpen = false" />
    </div>
</template>
