<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { StudentService } from '@/services/student/StudentService'
import { useStudentStore } from '@/stores/useStudentStore'
import { useEmailValidation } from '@/composables/useEmailValidation'
import { copyToClipboard as copyToClipboardUtil } from '@/utils/clipboard'
import ConfirmModal from '@/components/common/ConfirmModal.vue'

const props = defineProps<{
    studentId: string
    contacts: any[]
}>()

const { t } = useI18n()
const toast = useToast()
const { errorKey, reportError } = useFeedback()
const studentStore = useStudentStore()
const { validateEmail, getEmailError } = useEmailValidation()

const isModifying = ref(false)
const isAddFormOpen = ref(false)
const newContact = ref({ name: '', relation: '', phone: '', email: '' })
const contactEmailTouched = ref(false)
const contactEmailError = computed(() => contactEmailTouched.value ? getEmailError(newContact.value.email) : null)

const editingContactId = ref<string | null>(null)
const editContactForm = ref({ name: '', relation: '', phone: '', email: '' })

// Confirm Modal state for deletion
const showDeleteConfirm = ref(false)
const contactToDelete = ref<string | null>(null)

function resetNewContactForm() {
    newContact.value = { name: '', relation: '', phone: '', email: '' }
    contactEmailTouched.value = false
}

function closeAddContactForm() {
    isAddFormOpen.value = false
    resetNewContactForm()
}

async function addContact() {
    if (!newContact.value.name) return

    if (newContact.value.email && !validateEmail(newContact.value.email)) {
        contactEmailTouched.value = true
        errorKey('student.errors.email_invalid')
        return
    }

    try {
        isModifying.value = true
        await StudentService.addContact({ ...newContact.value, student_id: props.studentId })
        closeAddContactForm()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('student.contacts.add_btn') + ' ' + t('common.success'))
    } catch (e: any) {
        console.error(e)
        reportError(e, 'student.errors.add_contact_failed')
    } finally {
        isModifying.value = false
    }
}

function startEditContact(contact: any) {
    editingContactId.value = contact.id
    editContactForm.value = { ...contact }
}

function cancelEditContact() {
    editingContactId.value = null
    editContactForm.value = { name: '', relation: '', phone: '', email: '' }
}

async function saveContact() {
    if (!editingContactId.value) return
    try {
        isModifying.value = true
        await StudentService.updateContact(editingContactId.value, editContactForm.value)
        cancelEditContact()
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.save_success'))
    } catch (e) {
        console.error(e)
        reportError(e, 'student.errors.update_contact_failed')
    } finally {
        isModifying.value = false
    }
}

function confirmDeleteContact(id: string) {
    contactToDelete.value = id
    showDeleteConfirm.value = true
}

async function handleDeleteContact() {
    if (!contactToDelete.value) return
    try {
        isModifying.value = true
        await StudentService.deleteContact(contactToDelete.value)
        await studentStore.loadStudent(props.studentId)
        toast.success(t('common.deleted'))
    } catch (e: any) {
        console.error(e)
        reportError(e, 'student.errors.delete_contact_failed')
    } finally {
        isModifying.value = false
        showDeleteConfirm.value = false
        contactToDelete.value = null
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
</script>

<template>
    <section class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit transition-all hover:shadow-md">
        <h2 class="text-2xl font-bold mb-8 flex items-center gap-3 text-gray-800">
            <div class="p-2 bg-emerald-50 rounded-lg text-emerald-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                    stroke="currentColor" class="w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                </svg>
            </div>
            {{ $t('student.sections.contacts') }}
        </h2>

        <ul class="space-y-4 mb-8">
            <li v-for="c in contacts" :key="c.id"
                class="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-5 shadow-sm transition hover:border-emerald-200 hover:shadow-md">
                <div v-if="editingContactId !== c.id" class="flex justify-between items-start">
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-gray-800 text-xl flex flex-wrap items-center gap-3">
                            {{ c.name }}
                            <span v-if="c.relation"
                                class="text-sm text-gray-500 font-medium bg-white px-3 py-1 rounded-full border border-gray-100">{{
                                    c.relation }}</span>
                        </div>
                        <div v-if="c.phone" class="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-base text-slate-700">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                                stroke="currentColor" class="w-3.5 h-3.5">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                            </svg>
                            <a :href="`tel:${c.phone}`" class="min-w-0 flex-1 truncate font-bold text-emerald-700 hover:underline">{{ c.phone }}</a>
                            <button v-if="c.phone" @click="copyToClipboard(c.phone)"
                                class="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer"
                                :title="$t('common.copy')">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                </svg>
                            </button>
                        </div>
                        <div v-if="c.email" class="mt-2 flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-base text-slate-700">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                                stroke="currentColor" class="w-3.5 h-3.5">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                            </svg>
                            <a :href="`mailto:${c.email}`" class="min-w-0 flex-1 truncate font-bold text-emerald-700 hover:underline">{{ c.email }}</a>
                            <button v-if="c.email" @click="copyToClipboard(c.email)"
                                class="ml-1 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-400 transition-all hover:bg-emerald-50 hover:text-emerald-600 cursor-pointer"
                                :title="$t('common.copy')">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
                                    stroke-width="1.5" stroke="currentColor" class="w-3.5 h-3.5">
                                    <path stroke-linecap="round" stroke-linejoin="round"
                                        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="flex space-x-1">
                        <button @click="startEditContact(c)"
                            class="p-1.5 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer"
                            :title="$t('common.edit')">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round"
                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
                            </svg>
                        </button>
                        <button @click="confirmDeleteContact(c.id!)"
                            class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            :title="$t('common.delete')">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Edit Mode -->
                <div v-else class="space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                        <input v-model="editContactForm.name" :placeholder="$t('student.contacts.name')"
                            class="px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm rounded-xl border border-gray-200" :aria-label="$t('student.contacts.name')">
                        <input v-model="editContactForm.relation" :placeholder="$t('student.contacts.relation')"
                            class="px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm rounded-xl border border-gray-200" :aria-label="$t('student.contacts.relation')">
                        <input v-model="editContactForm.phone" :placeholder="$t('student.contacts.phone')"
                            class="px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm rounded-xl border border-gray-200" :aria-label="$t('student.contacts.phone')">
                        <input v-model="editContactForm.email" :placeholder="$t('student.contacts.email')"
                            class="px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm rounded-xl border border-gray-200" :aria-label="$t('student.contacts.email')">
                    </div>
                    <div class="flex justify-end space-x-2 pt-2">
                        <button @click="cancelEditContact"
                            class="text-gray-500 text-sm hover:text-gray-700 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors cursor-pointer">{{
                                $t('student.cancel') }}</button>
                        <button @click="saveContact" :disabled="isModifying"
                            class="bg-emerald-600 text-white px-8 py-2.5 rounded-xl text-base font-black uppercase tracking-widest hover:bg-emerald-700 shadow-lg shadow-emerald-50 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                            <svg v-if="isModifying" class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                </path>
                            </svg>
                            {{ $t('student.save_details') }}
                        </button>
                    </div>
                </div>
            </li>
        </ul>

        <div class="border-t border-gray-100 pt-8 mt-4">
            <button type="button" data-testid="student-contact-add-toggle" @click="isAddFormOpen = !isAddFormOpen"
                class="mb-4 flex w-full items-center justify-between rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-black uppercase tracking-widest text-gray-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50/50 hover:text-emerald-700">
                <span class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                    {{ $t('student.contacts.add_title') }}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 transition-transform"
                    :class="{ 'rotate-180': isAddFormOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" />
                </svg>
            </button>
            <div v-if="isAddFormOpen" data-testid="student-contact-add-form">
                <h3 class="sr-only">
                    {{ $t('student.contacts.add_title') }}
                </h3>
                <div
                    class="bg-gray-50 p-6 rounded-2xl border border-dashed border-gray-200 hover:border-emerald-200 transition-colors">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div class="space-y-1">
                            <label class="text-xs font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcontacts-134-12264">{{ $t('student.contacts.name') }}</label>
                            <input v-model="newContact.name" :placeholder="$t('student.contacts.name')"
                                class="w-full border-gray-200 rounded-xl px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm" id="edulog-studentcontacts-134-12264">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcontacts-139-12795">{{ $t('student.contacts.relation') }}</label>
                            <input v-model="newContact.relation" :placeholder="$t('student.contacts.relation')"
                                class="w-full border-gray-200 rounded-xl px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm" id="edulog-studentcontacts-139-12795">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcontacts-144-13338">{{ $t('student.contacts.phone') }}</label>
                            <input v-model="newContact.phone" :placeholder="$t('student.contacts.phone')"
                                class="w-full border-gray-200 rounded-xl px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm" id="edulog-studentcontacts-144-13338">
                        </div>
                        <div class="space-y-1">
                            <label class="text-xs font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block" for="edulog-studentcontacts-149-13872">{{ $t('student.contacts.email') }}</label>
                            <div class="relative">
                                <input v-model="newContact.email" type="email" @blur="contactEmailTouched = true"
                                    :placeholder="$t('student.contacts.email')"
                                    class="w-full border-gray-200 rounded-xl px-4 py-3 text-base font-bold bg-white focus:ring-2 focus:ring-emerald-500 outline-none transition-all shadow-sm"
                                    :class="{ 'border-red-500 focus:ring-red-500': contactEmailError }" id="edulog-studentcontacts-149-13872">
                                <p v-if="contactEmailError" class="text-xs text-red-500 mt-1">{{ contactEmailError }}</p>
                            </div>
                        </div>
                    </div>
                    <div class="flex flex-col gap-3 sm:flex-row">
                        <button @click="closeAddContactForm" :disabled="isModifying"
                            class="w-full rounded-xl border border-gray-200 bg-white py-4 text-base font-black uppercase tracking-widest text-gray-500 transition-all hover:bg-gray-50 disabled:opacity-50 sm:w-40">
                            {{ $t('common.cancel') }}
                        </button>
                        <button @click="addContact" :disabled="isModifying"
                            class="w-full bg-emerald-600 text-white py-4 rounded-xl hover:bg-emerald-700 text-base font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-50 flex items-center justify-center gap-3 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                            <svg v-if="isModifying" class="animate-spin h-4 w-4 text-emerald-600" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                </path>
                            </svg>
                            <svg v-else xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                                stroke="currentColor" class="w-4 h-4">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            {{ $t('student.contacts.add_btn') }}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('student.contacts.delete')"
            :message="$t('student.contacts.confirm_delete')" :confirm-text="$t('common.delete')" :is-dangerous="true"
            :is-loading="isModifying" @close="showDeleteConfirm = false" @confirm="handleDeleteContact" />
    </section>
</template>
