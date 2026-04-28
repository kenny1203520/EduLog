<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { TeacherService, type TeacherDTO } from '@/services/teacher/TeacherService'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import Pagination from '@/components/common/Pagination.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'

const { t } = useI18n()
const toast = useToast()

// Data
const teachers = ref<TeacherDTO[]>([])
const loading = ref(true)
const searchQuery = ref('')

// Pagination
const pagination = ref({ page: 1, perPage: 10, total: 0 })

// Modal States
const isCreateModalOpen = ref(false)
const isSaving = ref(false)
const editingTeacher = ref<TeacherDTO | null>(null)

// Form
const newTeacher = ref<Partial<TeacherDTO>>({
    user_id: '',
    name: '',
    email: '',
    phone: '',
    address: '',
    bio: ''
})

// Confirm Modal
const confirmModal = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as (() => any) | null
})

onMounted(async () => {
    await loadTeachers()
})

async function loadTeachers() {
    try {
        loading.value = true
        const res = await TeacherService.getTeachers(
            pagination.value.page,
            pagination.value.perPage,
            searchQuery.value || undefined
        )
        teachers.value = res.data
        pagination.value.total = res.count
    } catch (e) {
        toast.error(t('common.load_failed') || 'Failed to load teachers')
        console.error(e)
    } finally {
        loading.value = false
    }
}

async function saveTeacher() {
    if (!newTeacher.value.user_id || !newTeacher.value.name || !newTeacher.value.email) {
        toast.error(t('common.validation_error') || 'Please fill in required fields')
        return
    }

    try {
        isSaving.value = true
        if (editingTeacher.value?.id) {
            await TeacherService.updateTeacher(editingTeacher.value.id, newTeacher.value)
            toast.success(t('common.save_success') || 'Teacher updated successfully')
        } else {
            await TeacherService.createTeacher(newTeacher.value as Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>)
            toast.success(t('common.create_success') || 'Teacher created successfully')
        }

        await loadTeachers()
        closeModal()
    } catch (e) {
        toast.error(e as string)
    } finally {
        isSaving.value = false
    }
}

async function deleteTeacher(id: string) {
    try {
        await TeacherService.deleteTeacher(id)
        toast.success(t('common.delete_success') || 'Teacher deleted successfully')
        await loadTeachers()
    } catch (e) {
        toast.error(e as string)
    }
}

function openCreateModal() {
    editingTeacher.value = null
    newTeacher.value = {
        user_id: '',
        name: '',
        email: '',
        phone: '',
        address: '',
        bio: ''
    }
    isCreateModalOpen.value = true
}

function openEditModal(teacher: TeacherDTO) {
    editingTeacher.value = teacher
    newTeacher.value = { ...teacher }
    isCreateModalOpen.value = true
}

function closeModal() {
    isCreateModalOpen.value = false
    editingTeacher.value = null
}

function openDeleteConfirm(teacher: TeacherDTO) {
    confirmModal.value = {
        isOpen: true,
        title: t('common.delete_confirm') || 'Delete Teacher',
        message: `${t('common.confirm_delete') || 'Are you sure you want to delete'} "${teacher.name}"?`,
        confirmText: t('common.delete') || 'Delete',
        isDangerous: true,
        isLoading: false,
        action: () => deleteTeacher(teacher.id!)
    }
}

async function handleConfirm() {
    if (confirmModal.value.action) {
        try {
            confirmModal.value.isLoading = true
            await confirmModal.value.action()
            confirmModal.value.isOpen = false
        } catch (e) {
            console.error(e)
        } finally {
            confirmModal.value.isLoading = false
        }
    }
}
</script>

<template>
    <div class="p-6 md:p-8 min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        <!-- Header -->
        <div class="mb-8">
            <h1 class="text-3xl md:text-4xl font-bold text-gray-900 mb-2">{{ $t('teacher.management_title') || 'Teacher Management' }}</h1>
            <p class="text-gray-600">{{ $t('teacher.management_subtitle') || 'Manage teachers and their assignments' }}</p>
        </div>

        <!-- Search & Actions -->
        <div class="flex flex-col md:flex-row gap-4 mb-6">
            <input
                v-model="searchQuery"
                @input="pagination.page = 1; loadTeachers()"
                type="text"
                :placeholder="$t('common.search') || 'Search teachers...'"
                class="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
            <button
                @click="openCreateModal"
                class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors">
                {{ $t('common.add_new') || 'Add Teacher' }}
            </button>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="text-center py-12">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
        </div>

        <!-- Teachers Table -->
        <div v-else-if="teachers.length > 0" class="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-200">
            <table class="w-full">
                <thead class="bg-gray-50 border-b border-gray-200">
                    <tr>
                        <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">{{ $t('common.name') }}</th>
                        <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">{{ $t('common.email') }}</th>
                        <th class="px-6 py-3 text-left text-sm font-semibold text-gray-700">{{ $t('common.phone') }}</th>
                        <th class="px-6 py-3 text-center text-sm font-semibold text-gray-700">{{ $t('common.actions') }}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                    <tr v-for="teacher in teachers" :key="teacher.id" class="hover:bg-gray-50 transition-colors">
                        <td class="px-6 py-4">
                            <div class="font-medium text-gray-900">{{ teacher.name }}</div>
                            <div v-if="teacher.bio" class="text-sm text-gray-500">{{ teacher.bio }}</div>
                        </td>
                        <td class="px-6 py-4 text-gray-700">{{ teacher.email }}</td>
                        <td class="px-6 py-4 text-gray-700">{{ teacher.phone || '-' }}</td>
                        <td class="px-6 py-4 text-center">
                            <button
                                @click="openEditModal(teacher)"
                                class="px-3 py-1 text-sm text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors mr-2">
                                {{ $t('common.edit') }}
                            </button>
                            <button
                                @click="openDeleteConfirm(teacher)"
                                class="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                {{ $t('common.delete') }}
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Empty State -->
        <div v-else class="text-center py-12 bg-white rounded-2xl border border-gray-200">
            <p class="text-gray-500">{{ $t('common.no_data') || 'No teachers found' }}</p>
        </div>

        <!-- Pagination -->
        <div v-if="pagination.total > 0" class="mt-6 flex justify-center">
            <Pagination
                :modelValue="pagination.page"
                :perPage="pagination.perPage"
                :totalItems="pagination.total"
                @update:modelValue="pagination.page = $event; loadTeachers()"
                @update:perPage="pagination.perPage = $event; pagination.page = 1; loadTeachers()" />
        </div>

        <!-- Create/Edit Modal -->
        <div
            v-if="isCreateModalOpen"
            class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div class="bg-white rounded-2xl shadow-xl max-w-md w-full">
                <div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                    <h2 class="text-xl font-bold">
                        {{ editingTeacher ? $t('common.edit_teacher') || 'Edit Teacher' : $t('common.add_teacher') || 'Add Teacher' }}
                    </h2>
                    <button @click="closeModal" class="text-gray-400 hover:text-gray-600">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="p-6 space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('common.user_id') || 'User ID' }} *</label>
                        <input
                            v-model="newTeacher.user_id"
                            type="text"
                            disabled
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                            placeholder="UUID">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('common.name') }} *</label>
                        <input
                            v-model="newTeacher.name"
                            type="text"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('common.email') }} *</label>
                        <input
                            v-model="newTeacher.email"
                            type="email"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('common.phone') }}</label>
                        <input
                            v-model="newTeacher.phone"
                            type="tel"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('common.address') }}</label>
                        <input
                            v-model="newTeacher.address"
                            type="text"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent">
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('common.bio') }}</label>
                        <textarea
                            v-model="newTeacher.bio"
                            rows="3"
                            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"></textarea>
                    </div>
                </div>

                <div class="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        @click="closeModal"
                        :disabled="isSaving"
                        class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">
                        {{ $t('common.cancel') }}
                    </button>
                    <button
                        @click="saveTeacher"
                        :disabled="isSaving"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors disabled:opacity-50">
                        {{ isSaving ? $t('common.saving') || 'Saving...' : $t('common.save') || 'Save' }}
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
