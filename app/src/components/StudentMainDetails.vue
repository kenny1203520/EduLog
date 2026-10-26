<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { useRouter } from 'vue-router'
import { useStudentStore } from '@/stores/useStudentStore'
import { useEmailValidation } from '@/composables/useEmailValidation'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import TextEditor from '@/components/common/text-editor/TextEditor.vue'
import RichTextViewer from '@/components/common/text-editor/RichTextViewer.vue'
import { createTextEditorContent } from '@/components/common/text-editor/content'
import type { RichTextDocumentV1, TextEditorContent } from '@/components/common/text-editor/types'

const props = withDefaults(defineProps<{
    studentId: string
    canReadSensitive?: boolean
    canUpdateSensitive?: boolean
}>(), {
    canReadSensitive: false,
    canUpdateSensitive: false,
})

const { t } = useI18n()
const toast = useToast()
const { errorKey, reportError } = useFeedback()
const router = useRouter()
const studentStore = useStudentStore()
const { validateEmail, getEmailError } = useEmailValidation()

const showDeleteConfirm = ref(false)
const isSaving = ref(false)
const isDeleting = ref(false)
const isEditingMainDetails = ref(false)
const showGovId = ref(false)

// Form State
interface StudentForm {
    name: string
    gov_id: string
    email: string
    phone: string
    residence_address: string
    mailing_address: string
    birthday: string
    external_link: string
    notes: string
    notes_document: RichTextDocumentV1
}

const form = ref<StudentForm>({
    name: '',
    gov_id: '',
    email: '',
    phone: '',
    residence_address: '',
    mailing_address: '',
    birthday: '',
    external_link: '',
    notes: '',
    notes_document: createTextEditorContent('').richText
})

const notesContent = computed<TextEditorContent>({
    get: () => createTextEditorContent(form.value.notes_document || form.value.notes),
    set: (content) => {
        form.value.notes = content.plainText
        form.value.notes_document = content.richText
    }
})

const emailTouched = ref(false)
const emailError = computed(() => emailTouched.value ? getEmailError(form.value.email) : null)

function populateForm() {
    const s = studentStore.currentStudent
    if (!s) return
    form.value = {
        name: s.name,
        gov_id: s.gov_id,
        email: s.email,
        phone: s.phone,
        residence_address: s.residence_address,
        mailing_address: s.mailing_address,
        birthday: s.birthday,
        external_link: s.external_link,
        notes: s.notes,
        notes_document: s.notesDocument
    }
}

// Initial population
watch(() => studentStore.currentStudent, () => {
    if (!isEditingMainDetails.value) {
        populateForm()
    }
}, { immediate: true })

function toggleEditMainDetails() {
    if (isEditingMainDetails.value) {
        populateForm()
        isEditingMainDetails.value = false
    } else {
        isEditingMainDetails.value = true
    }
}

async function saveMainDetails() {
    if (form.value.email && !validateEmail(form.value.email)) {
        emailTouched.value = true
        errorKey('student.errors.email_invalid')
        return
    }

    isSaving.value = true
    try {
        const payload = {
            name: form.value.name,
            external_link: form.value.external_link || null,
            notes: form.value.notes,
            notes_document: form.value.notes_document,
            ...(props.canUpdateSensitive ? {
                gov_id: form.value.gov_id,
                email: form.value.email,
                phone: form.value.phone,
                residence_address: form.value.residence_address,
                mailing_address: form.value.mailing_address,
                birthday: form.value.birthday || null,
            } : {}),
        }
        await studentStore.updateStudent(props.studentId, payload)
        emailTouched.value = false
        toast.success(t('common.save_success'))
        isEditingMainDetails.value = false
    } catch (e) {
        console.error(e)
        reportError(e, 'student.errors.save_details_failed')
    } finally {
        isSaving.value = false
    }
}

function handleDeleteStudent() {
    showDeleteConfirm.value = true
}

async function confirmDeleteStudent() {
    try {
        isDeleting.value = true
        await studentStore.deleteStudent(props.studentId)
        showDeleteConfirm.value = false
        router.push('/dashboard')
    } catch (e: any) {
        console.error(e)
        reportError(e, 'student.errors.delete_student_failed')
    } finally {
        isDeleting.value = false
    }
}

watch(isEditingMainDetails, (val) => {
    if (val) {
        showGovId.value = true
    }
})
</script>

<template>
    <!-- Main Details Form -->
    <section class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
        <h2 class="text-2xl font-bold mb-8 flex items-center gap-3 text-gray-800">
            <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                    stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
            </div>
            {{ $t('student.details') }}
        </h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-1.5">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-17-931">{{ $t('student.name')
                }}</label>
                <input v-if="isEditingMainDetails" v-model="form.name" type="text"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400" id="edulog-studentmaindetails-17-931">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                    {{ form.name || '-' }}</div>
            </div>

            <div v-if="canReadSensitive" class="space-y-1.5">
                <div class="flex items-center gap-2 mb-1.5">
                    <label for="student-government-id" class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{
                        $t('student.gov_id') }}</label>
                    <button @click.stop="showGovId = !showGovId"
                        class="text-gray-400 hover:text-gray-600 focus:outline-none"
                        :title="showGovId ? $t('common.hide') : $t('common.show')" type="button">
                        <svg v-if="showGovId" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                            stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
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
                </div>
                <input v-if="isEditingMainDetails && canUpdateSensitive" v-model="form.gov_id" :type="showGovId ? 'text' : 'password'"
                    id="student-government-id" class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px] font-mono flex items-center">
                    <span v-if="showGovId">{{ form.gov_id || '-' }}</span>
                    <span v-else>{{ form.gov_id ? '•'.repeat(Math.min(form.gov_id.length, 10)) : '-' }}</span>
                </div>
            </div>

            <div v-if="canReadSensitive" class="space-y-1.5">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-57-4465">{{ $t('student.birthday')
                }}</label>
                <input v-if="isEditingMainDetails && canUpdateSensitive" v-model="form.birthday" type="date"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400" id="edulog-studentmaindetails-57-4465">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                    {{ form.birthday || '-' }}</div>
            </div>

            <div class="space-y-1.5">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-67-5252">{{
                    $t('student.external_link') }}</label>
                <input v-if="isEditingMainDetails" v-model="form.external_link" type="url" placeholder="https://"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400" id="edulog-studentmaindetails-67-5252">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px] overflow-hidden text-ellipsis whitespace-nowrap">
                    <a v-if="form.external_link" :href="form.external_link" target="_blank" rel="noopener noreferrer"
                        class="text-emerald-600 hover:text-emerald-700 underline flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                            stroke="currentColor" class="w-4 h-4">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
                        </svg>
                        {{ $t('common.view_link', 'View Link') }}
                    </a>
                    <span v-else>-</span>
                </div>
            </div>

            <div v-if="canReadSensitive" class="space-y-1.5">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-87-6956">{{ $t('auth.email')
                }}</label>
                <input v-if="isEditingMainDetails && canUpdateSensitive" v-model="form.email" type="email" @blur="emailTouched = true"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400"
                    :class="{ 'border-red-500 focus:ring-red-500': emailError }" id="edulog-studentmaindetails-87-6956">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                    {{ form.email || '-' }}</div>
                <p v-if="emailError && isEditingMainDetails" class="text-xs text-red-500 mt-1">{{ emailError }}</p>
            </div>
            <div v-if="canReadSensitive" class="space-y-1.5">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-98-7980">{{
                    $t('student.contacts.phone') }}</label>
                <input v-if="isEditingMainDetails && canUpdateSensitive" v-model="form.phone" type="tel"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400" id="edulog-studentmaindetails-98-7980">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                    {{ form.phone || '-' }}</div>
            </div>

            <div v-if="canReadSensitive" class="space-y-1.5 md:col-span-2">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-108-8808">{{
                    $t('student.residence_address') }}</label>
                <input v-if="isEditingMainDetails && canUpdateSensitive" v-model="form.residence_address" type="text"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400" id="edulog-studentmaindetails-108-8808">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                    {{ form.residence_address || '-' }}</div>
            </div>
            <div v-if="canReadSensitive" class="space-y-1.5 md:col-span-2">
                <label class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentmaindetails-117-9663">{{
                    $t('student.mailing_address') }}</label>
                <input v-if="isEditingMainDetails && canUpdateSensitive" v-model="form.mailing_address" type="text"
                    class="w-full border-gray-200 rounded-lg px-4 py-3 text-base font-bold focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all outline-none bg-gray-50 focus:bg-white text-gray-800 placeholder-gray-400" id="edulog-studentmaindetails-117-9663">
                <div v-else
                    class="text-gray-800 px-4 py-3 text-base font-bold bg-gray-50/50 rounded-lg border border-transparent min-h-[46px]">
                    {{ form.mailing_address || '-' }}</div>
            </div>

            <div class="space-y-1.5 md:col-span-2">
                <p class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">{{ $t('student.notes')
                }}</p>
                <TextEditor v-if="isEditingMainDetails" v-model="notesContent" :aria-label="$t('student.notes')" preset="form" :min-height="86" />
                <RichTextViewer v-else-if="form.notes" :content="notesContent" :min-height="86" />
                <div v-else class="text-gray-800 px-4 py-3">-</div>
            </div>
        </div>

        <div class="mt-8 flex justify-between items-center pt-6 border-t border-gray-100">
            <button @click="handleDeleteStudent"
                class="text-red-500 hover:text-red-700 text-base font-bold hover:underline cursor-pointer flex items-center gap-2 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                    stroke="currentColor" class="w-4 h-4">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
                {{ $t('student.delete') }}
            </button>

            <div class="flex items-center gap-2">
                <button v-if="isEditingMainDetails" @click="toggleEditMainDetails"
                    class="text-gray-500 hover:text-gray-700 font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                    {{ $t('student.cancel') }}
                </button>
                <button @click="isEditingMainDetails ? saveMainDetails() : toggleEditMainDetails()"
                    :disabled="isSaving"
                    class="bg-emerald-600 text-white px-8 py-3 rounded-xl shadow-sm hover:bg-emerald-700 hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed text-base font-black uppercase tracking-widest flex items-center gap-2 cursor-pointer">
                    <svg v-if="!isSaving && isEditingMainDetails" xmlns="http://www.w3.org/2000/svg" fill="none"
                        viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <svg v-else-if="!isSaving" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                        stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round"
                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                    </svg>
                    <svg v-else class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg"
                        fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                        </circle>
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                        </path>
                    </svg>
                    {{ isSaving ? $t('student.saving') : (isEditingMainDetails ? $t('student.save_details') :
                        $t('student.edit')) }}
                </button>
            </div>
        </div>

        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('student.delete_confirm_title')"
            :message="$t('student.delete_confirm_message')" :confirm-text="$t('student.delete')"
            :is-dangerous="true" :is-loading="isDeleting" @close="showDeleteConfirm = false"
            @confirm="confirmDeleteStudent" />
    </section>
</template>
