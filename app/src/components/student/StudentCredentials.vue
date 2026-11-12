<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { useStudentStore } from '@/stores/useStudentStore'
import { copyToClipboard as copyToClipboardUtil } from '@/utils/clipboard'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import { isKodingPlatform, KODING_PLATFORM } from '@/utils/koding'
import { StudentCommandService } from '@/services/student/StudentCommandService'

const props = withDefaults(defineProps<{
    studentId: string
    credentials: any[]
    /** Section update permission; hides add, edit and delete controls when false. */
    canUpdate?: boolean
}>(), { canUpdate: true })

const { t } = useI18n()
const toast = useToast()
const { errorKey, reportError } = useFeedback()
const studentStore = useStudentStore()

const isModifying = ref(false)
const isAddFormOpen = ref(false)
const newCredential = ref({ platform: '', username: '', password: '', url: '' })
const editingCredentialId = ref<string | null>(null)
const editCredentialForm = ref({ platform: '', username: '', password: '', url: '' })
const visiblePasswords = ref(new Set<string>())

const platformOptions = [
    { label: t('student.credentials.platforms.koding_school_orange_apple'), value: KODING_PLATFORM },
    { label: t('student.credentials.platforms.Roblox'), value: 'Roblox' },
    { label: t('student.credentials.platforms.Minecraft'), value: 'Minecraft' },
    { label: t('student.credentials.platforms.Anydesk'), value: 'Anydesk' },
    { label: t('student.credentials.platforms.Quiz Platform'), value: 'Quiz Platform' },
    { label: t('student.credentials.platforms.Discord'), value: 'Discord' },
    { label: t('student.credentials.platforms.Other'), value: 'Other' }
]

const isOtherPlatformAdd = ref(false)
const otherPlatformAdd = ref('')
const isOtherPlatformEdit = ref(false)
const otherPlatformEdit = ref('')

// Confirm Modal state for deletion
const showDeleteConfirm = ref(false)
const credentialToDelete = ref<string | null>(null)

function resetNewCredentialForm() {
    newCredential.value = { platform: '', username: '', password: '', url: '' }
    otherPlatformAdd.value = ''
    isOtherPlatformAdd.value = false
}

function closeAddCredentialForm() {
    isAddFormOpen.value = false
    resetNewCredentialForm()
}

async function addCredential() {
    const platformValue = newCredential.value.platform === 'Other' ? otherPlatformAdd.value.trim() : newCredential.value.platform

    if (!platformValue) {
        errorKey('student.errors.platform_required')
        return
    }
    if (![newCredential.value.username, newCredential.value.password, newCredential.value.url].some(value => value.trim())) {
        errorKey('student.errors.credential_value_required')
        return
    }

    try {
        isModifying.value = true
        await StudentCommandService.addCredential({ ...newCredential.value, platform: platformValue, student_id: props.studentId })
        closeAddCredentialForm()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('student.credentials.add_btn') + ' ' + t('common.success'))
    } catch (e: any) {
        console.error(e)
        reportError(e, 'student.errors.add_credential_failed')
    } finally {
        isModifying.value = false
    }
}

function startEditCredential(cred: any) {
    editingCredentialId.value = cred.id
    const normalizedCredential = {
        ...cred,
        platform: isKodingPlatform(cred.platform) ? KODING_PLATFORM : cred.platform
    }
    const isPredefined = platformOptions.some(opt => opt.value === normalizedCredential.platform && opt.value !== 'Other')
    if (isPredefined) {
        editCredentialForm.value = normalizedCredential
        isOtherPlatformEdit.value = false
    } else {
        editCredentialForm.value = { ...normalizedCredential, platform: 'Other' }
        otherPlatformEdit.value = cred.platform
        isOtherPlatformEdit.value = true
    }
}

function cancelEditCredential() {
    editingCredentialId.value = null
    editCredentialForm.value = { platform: '', username: '', password: '', url: '' }
}

async function saveCredential() {
    if (!editingCredentialId.value) return
    const platformValue = editCredentialForm.value.platform === 'Other' ? otherPlatformEdit.value.trim() : editCredentialForm.value.platform
    if (!platformValue) {
        errorKey('student.errors.platform_required')
        return
    }
    if (![editCredentialForm.value.username, editCredentialForm.value.password, editCredentialForm.value.url].some(value => value.trim())) {
        errorKey('student.errors.credential_value_required')
        return
    }
    try {
        isModifying.value = true
        await StudentCommandService.updateCredential(editingCredentialId.value, { ...editCredentialForm.value, platform: platformValue })
        cancelEditCredential()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.save_success'))
    } catch (e) {
        console.error(e)
        reportError(e, 'student.errors.update_credential_failed')
    } finally {
        isModifying.value = false
    }
}

function confirmDeleteCredential(id: string) {
    credentialToDelete.value = id
    showDeleteConfirm.value = true
}

async function handleDeleteCredential() {
    if (!credentialToDelete.value) return
    try {
        isModifying.value = true
        await StudentCommandService.deleteCredential(credentialToDelete.value)
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.deleted'))
    } catch (e: any) {
        console.error(e)
        reportError(e, 'student.errors.delete_credential_failed')
    } finally {
        isModifying.value = false
        showDeleteConfirm.value = false
        credentialToDelete.value = null
    }
}

function togglePasswordVisibility(id: string) {
    if (visiblePasswords.value.has(id)) {
        visiblePasswords.value.delete(id)
    } else {
        visiblePasswords.value.add(id)
    }
}

async function copyToClipboard(text: string) {
    if (!text) return
    const success = await copyToClipboardUtil(text)
    if (success) {
        toast.success(t('common.copy_success'))
    } else {
        errorKey('common.copy_error')
    }
}

function credentialUrl(url: string): string {
    const value = url.trim()
    return /^https?:\/\//i.test(value) ? value : `https://${value}`
}
</script>

<template>
    <section class="h-fit min-w-0 overflow-hidden rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:shadow-md sm:p-6">
        <h2 class="text-xl font-bold mb-6 flex items-center gap-2 text-gray-800">
            <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                    stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
                </svg>
            </div>
            {{ $t('student.sections.credentials') }}
        </h2>

        <ul class="space-y-4 mb-8">
            <li v-for="c in credentials" :key="c.id"
                class="bg-gray-50 p-4 rounded-xl border border-transparent hover:border-gray-200 transition-colors">
                <div v-if="editingCredentialId !== c.id">
                    <div class="flex justify-between items-start mb-3">
                        <div class="font-bold text-gray-800 text-lg flex items-center gap-2">
                            {{ c.platform }}
                            <span v-if="c.notes"
                                class="text-[12px] font-medium text-gray-400 border border-gray-200 px-1.5 py-0.5 rounded italic truncate max-w-[150px]"
                                :title="c.notes">{{ c.notes }}</span>
                        </div>
                        <div class="flex space-x-1">
                            <button v-if="canUpdate" @click="startEditCredential(c)"
                                class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                                :title="$t('common.edit')">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                                </svg>
                            </button>
                            <button v-if="canUpdate" @click="confirmDeleteCredential(c.id!)"
                                class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                :title="$t('common.delete')">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <div v-if="c.username"
                            class="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-100 group">
                            <div class="flex flex-col">
                                <span class="text-[12px] text-gray-400 uppercase font-bold tracking-wider">{{
                                    $t('student.credentials.username') }}</span>
                                <span class="text-sm font-mono text-gray-700 break-all">{{ c.username }}</span>
                            </div>
                            <button @click="copyToClipboard(c.username)"
                                class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer"
                                :title="$t('student.credentials.copy_username')">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                </svg>
                            </button>
                        </div>
                        <div v-if="c.password"
                            class="flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-gray-100 group">
                            <div class="flex flex-col">
                                <span class="text-[12px] text-gray-400 uppercase font-bold tracking-wider">{{
                                    $t('student.credentials.password') }}</span>
                                <span class="text-sm font-mono text-gray-700 break-all">
                                    {{ visiblePasswords.has(c.id) ? c.password : '••••••••' }}
                                </span>
                            </div>
                            <div class="flex items-center gap-1">
                                <button @click="togglePasswordVisibility(c.id)"
                                    class="p-1 text-gray-300 hover:text-gray-600 transition-colors cursor-pointer"
                                    :title="visiblePasswords.has(c.id) ? $t('common.hide') : $t('common.show')">
                                    <svg v-if="visiblePasswords.has(c.id)" xmlns="http://www.w3.org/2000/svg"
                                        fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"
                                        class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                                    </svg>
                                    <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                                    </svg>
                                </button>
                                <button @click="copyToClipboard(c.password)"
                                    class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer"
                                    :title="$t('student.credentials.copy_password')">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                        stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                                        <path stroke-linecap="round" stroke-linejoin="round"
                                            d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <a v-if="c.url" :href="credentialUrl(c.url)" target="_blank" rel="noopener noreferrer"
                            class="flex items-center justify-between gap-3 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700 transition hover:bg-sky-100">
                            <span class="min-w-0 truncate">{{ c.url }}</span>
                            <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H19.5m0 0v6m0-6L10 15.5M6 10.5v7.25A2.25 2.25 0 0 0 8.25 20h7.25A2.25 2.25 0 0 0 17.75 17.75V15" /></svg>
                        </a>
                    </div>
                </div>

                <div v-else class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="w-full">
                            <label
                                class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-113-10123">{{
                                    $t('student.credentials.platform') }}</label>
                            <BaseDropdown v-model="editCredentialForm.platform" :options="platformOptions"
                                theme="emerald"  id="edulog-studentcredentials-113-10123"/>
                        </div>
                        <div v-if="editCredentialForm.platform === 'Other'">
                            <label
                                class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-120-10628">{{
                                    $t('student.credentials.platform_name') }}</label>
                            <input v-model="otherPlatformEdit" :placeholder="$t('student.credentials.platform_name')"
                                class="w-full border-gray-300 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-120-10628">
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-50">
                        <div class="w-full">
                            <label
                                class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-130-11358">{{
                                    $t('student.credentials.username') }}</label>
                            <input v-model="editCredentialForm.username"
                                :placeholder="$t('student.credentials.username')"
                                class="w-full border-gray-300 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-130-11358">
                        </div>
                        <div class="w-full">
                            <label
                                class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-138-11991">{{
                                    $t('student.credentials.password') }}</label>
                            <input v-model="editCredentialForm.password"
                                :placeholder="$t('student.credentials.password')"
                                class="w-full border-gray-300 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-138-11991">
                        </div>
                        <div class="sm:col-span-2">
                            <label
                                class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-146-12631">{{
                                    $t('student.credentials.url') }}</label>
                            <input v-model="editCredentialForm.url" :placeholder="$t('student.credentials.url')"
                                class="w-full border-gray-300 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-146-12631">
                        </div>
                    </div>

                    <div class="flex justify-end gap-3 pt-2">
                        <button @click="cancelEditCredential"
                            class="px-4 py-2 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest cursor-pointer">
                            {{ $t('common.cancel') }}
                        </button>
                        <button @click="saveCredential" :disabled="isModifying"
                            class="bg-emerald-600 text-white px-8 py-2.5 rounded-xl text-sm font-black hover:bg-emerald-700 shadow-lg shadow-emerald-50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                            <svg v-if="isModifying" class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                </path>
                            </svg>
                            {{ $t('common.save') }}
                        </button>
                    </div>
                </div>
            </li>
        </ul>

        <div class="border-t border-gray-100 pt-6">
            <button v-if="canUpdate" type="button" data-testid="student-credential-add-toggle" @click="isAddFormOpen = !isAddFormOpen"
                class="mb-3 flex w-full items-center justify-between rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-left text-xs font-black uppercase tracking-widest text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700">
                <span class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    {{ $t('student.credentials.add_btn') }}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
                    :class="{ 'rotate-180': isAddFormOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
                </svg>
            </button>
            <div
                v-if="isAddFormOpen" data-testid="student-credential-add-form"
                class="bg-gray-50 p-6 rounded-2xl border-2 border-dashed border-gray-200 hover:border-emerald-200 transition-all space-y-4">

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="w-full">
                        <label class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-194-16094">{{
                            $t('student.credentials.platform') }}</label>
                        <BaseDropdown v-model="newCredential.platform" :options="platformOptions" theme="emerald"  id="edulog-studentcredentials-194-16094"/>
                    </div>
                    <div v-if="newCredential.platform === 'Other'" class="w-full">
                        <label class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-199-16516">{{
                            $t('student.credentials.platform_name') }}</label>
                        <input v-model="otherPlatformAdd" :placeholder="$t('student.credentials.platform_name')"
                            class="w-full border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-199-16516">
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                    <div class="w-full">
                        <label class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-208-17178">{{
                            $t('student.credentials.username') }}</label>
                        <input v-model="newCredential.username" :placeholder="$t('student.credentials.username')"
                            class="w-full border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-208-17178">
                    </div>
                    <div class="w-full">
                        <label class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-214-17714">{{
                            $t('student.credentials.password') }}</label>
                        <input v-model="newCredential.password" :placeholder="$t('student.credentials.password')"
                            class="w-full border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-214-17714">
                    </div>
                    <div class="sm:col-span-2">
                        <label class="text-[12px] font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcredentials-220-18257">{{
                            $t('student.credentials.url') }}</label>
                        <input v-model="newCredential.url" :placeholder="$t('student.credentials.url')"
                            class="w-full border-gray-200 rounded-xl px-4 py-2.5 text-sm font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none" id="edulog-studentcredentials-220-18257">
                    </div>
                </div>

                <div class="flex flex-col gap-3 sm:flex-row">
                    <button @click="closeAddCredentialForm" :disabled="isModifying"
                        class="w-full rounded-xl border border-gray-200 bg-white py-3 text-sm font-black uppercase tracking-widest text-gray-500 transition-all hover:bg-gray-50 disabled:opacity-50 sm:w-40">
                        {{ $t('common.cancel') }}
                    </button>
                    <button @click="addCredential" :disabled="isModifying"
                        class="w-full bg-emerald-600 text-white py-3 rounded-xl hover:bg-emerald-700 text-sm font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-50 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <svg v-if="isModifying" class="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5"
                            stroke="currentColor" class="w-5 h-5">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        {{ $t('student.credentials.add_btn') }}
                    </button>
                </div>
            </div>
        </div>

        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('student.credentials.delete')"
            :message="$t('student.credentials.confirm_delete')" :confirm-text="$t('common.delete')" :is-dangerous="true"
            :is-loading="isModifying" @close="showDeleteConfirm = false" @confirm="handleDeleteCredential" />
    </section>
</template>
