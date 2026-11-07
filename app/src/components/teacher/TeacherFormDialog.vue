<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFeedback } from '@/composables/useFeedback'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import TextEditor from '@/components/text-editor/TextEditor.vue'
import { createTextEditorContent } from '@/components/text-editor/content'
import type { TextEditorContent } from '@/components/text-editor/types'
import { TeacherService, type TeacherCredentialDTO, type TeacherDTO } from '@/services/teacher/TeacherService'
import { AuthUserSearchService, type AuthUserSearchResultDTO } from '@/services/auth/AuthUserSearchService'
import { isKodingPlatform, KODING_PLATFORM } from '@/utils/koding'

/**
 * Create or edit a teacher in a native modal <dialog>: the browser handles
 * focus containment, Esc, inert background and focus return. Controls inside
 * avoid components that teleport menus to <body>, which a modal makes inert.
 */
const props = defineProps<{
    open: boolean
    /** Teacher to edit; null creates a new teacher. */
    teacherId: string | null
    canEditSensitive: boolean
}>()
const emit = defineEmits<{
    (e: 'close'): void
    (e: 'saved', teacherId: string | null): void
}>()

const { t } = useI18n()
const { errorKey, reportError, success } = useFeedback()
const dialog = ref<HTMLDialogElement | null>(null)

type EditableCredential = TeacherCredentialDTO & { platformSelection: string; customPlatform: string }

const loading = ref(false)
const saving = ref(false)
const credentialSaving = ref(false)
const editing = ref<TeacherDTO | null>(null)
const form = ref(emptyForm())
const linkedAccount = ref<AuthUserSearchResultDTO | null>(null)
const userQuery = ref('')
const userResults = ref<AuthUserSearchResultDTO[]>([])
const userSearching = ref(false)
const userMessage = ref('')
const onlyUnlinked = ref(true)
const credentials = ref<EditableCredential[]>([])
const addCredentialOpen = ref(false)
const newCredential = ref(emptyCredential())

const titleId = 'teacher-form-title'
const isEditing = computed(() => Boolean(props.teacherId))
const platformOptions = computed(() => [
    { label: t('teacher.credentials_platforms.koding_school_orange_apple'), value: KODING_PLATFORM },
    ...['Roblox', 'Minecraft', 'Anydesk', 'Quiz Platform', 'Discord'].map(value => ({ label: t(`teacher.credentials_platforms.${value}`), value })),
    { label: t('teacher.credentials_platforms.Other'), value: 'Other' },
])
const bioContent = computed<TextEditorContent>({
    get: () => createTextEditorContent(form.value.bio_document || form.value.bio || ''),
    set: (content) => { form.value.bio = content.plainText; form.value.bio_document = content.richText },
})

function emptyForm(): Partial<TeacherDTO> {
    return { name: '', email: '', phone: '', birthday: '', gov_id: '', address: '', bio: '', bio_document: createTextEditorContent('').richText }
}

function emptyCredential() {
    return { platform: '', customPlatform: '', username: '', password: '', url: '' }
}

function platformSelection(platform?: string) {
    if (!platform) return ''
    if (isKodingPlatform(platform)) return KODING_PLATFORM
    return platformOptions.value.some(option => option.value === platform && option.value !== 'Other') ? platform : 'Other'
}

function toEditable(credential: TeacherCredentialDTO): EditableCredential {
    const selection = platformSelection(credential.platform)
    return { ...credential, platformSelection: selection, customPlatform: selection === 'Other' ? credential.platform : '' }
}

function resolvePlatform(selection: string, custom: string) {
    return selection === 'Other' ? custom.trim() : selection
}

async function loadTeacher() {
    if (!props.teacherId) return
    loading.value = true
    try {
        const detail = await TeacherService.getTeacherById(props.teacherId)
        editing.value = detail
        form.value = {
            name: detail.name ?? '', email: detail.email ?? '', phone: detail.phone ?? '', birthday: detail.birthday ?? '',
            gov_id: detail.gov_id ?? '', address: detail.address ?? '', bio: detail.bio ?? '',
            bio_document: detail.bio_document || createTextEditorContent(detail.bio || '').richText,
        }
        credentials.value = (detail.teacher_credentials ?? []).map(toEditable)
    } catch (error) {
        reportError(error, 'teacher.load_failed')
        emit('close')
    } finally { loading.value = false }
}

function reset() {
    editing.value = null
    form.value = emptyForm()
    linkedAccount.value = null
    userQuery.value = ''
    userResults.value = []
    userMessage.value = ''
    credentials.value = []
    addCredentialOpen.value = false
    newCredential.value = emptyCredential()
}

watch(() => props.open, async (open) => {
    await nextTick()
    if (!dialog.value) return
    if (open) {
        reset()
        if (!dialog.value.open) {
            if (typeof dialog.value.showModal === 'function') dialog.value.showModal()
            else dialog.value.setAttribute('open', '')
        }
        await loadTeacher()
    } else if (dialog.value.open) {
        if (typeof dialog.value.close === 'function') dialog.value.close()
        else dialog.value.removeAttribute('open')
    }
}, { immediate: true })

async function searchUsers() {
    const query = userQuery.value.trim()
    if (!query) { userResults.value = []; userMessage.value = t('teacher.user_search_empty'); return }
    userSearching.value = true
    userMessage.value = ''
    try {
        userResults.value = await AuthUserSearchService.searchUsersByEmail(query, { onlyUnlinked: onlyUnlinked.value })
        if (!userResults.value.length) userMessage.value = t('teacher.user_search_no_results', { query })
    } catch (error) {
        userResults.value = []
        userMessage.value = t('teacher.user_search_failed')
        console.warn('User search failed', error)
    } finally { userSearching.value = false }
}

function chooseAccount(account: AuthUserSearchResultDTO) {
    linkedAccount.value = account
    userResults.value = []
    userMessage.value = ''
    if (!form.value.email) form.value.email = account.email
    if (!form.value.name && account.display_name) form.value.name = account.display_name
}

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

async function save() {
    const name = form.value.name?.trim()
    const email = form.value.email?.trim() || null
    if (!name) { errorKey('teacher.validation_required'); return }
    if (email && !isValidEmail(email)) { errorKey('teacher.validation_email'); return }
    if (form.value.gov_id && form.value.gov_id.trim().length > 20) { errorKey('teacher.validation_gov_id'); return }
    const payload: Partial<TeacherDTO> = {
        name,
        bio: bioContent.value.plainText || null,
        bio_document: bioContent.value.richText,
        ...(props.canEditSensitive ? {
            email,
            phone: form.value.phone?.trim() || null,
            birthday: form.value.birthday?.toString().trim() || null,
            gov_id: form.value.gov_id?.trim() || null,
            address: form.value.address?.trim() || null,
        } : {}),
    }
    saving.value = true
    try {
        if (props.teacherId) {
            await TeacherService.updateTeacher(props.teacherId, payload)
            success('teacher.update_success')
            emit('saved', props.teacherId)
        } else {
            const created = await TeacherService.createTeacher({ ...payload, user_id: linkedAccount.value?.id ?? null } as Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>)
            success('teacher.create_success')
            emit('saved', created.id ?? null)
        }
    } catch (error) {
        if ((error as { code?: string } | null)?.code === 'TEACHER_ACCOUNT_ALREADY_LINKED') errorKey('teacher.error_duplicate_user')
        else reportError(error, 'teacher.save_failed')
    } finally { saving.value = false }
}

function validCredential(platform: string, username: string, password: string) {
    if (!platform || !username || (!isKodingPlatform(platform) && !password)) {
        errorKey('teacher.credentials_platform_required')
        return false
    }
    return true
}

async function refreshCredentials() {
    if (!props.teacherId) return
    const detail = await TeacherService.getTeacherById(props.teacherId)
    credentials.value = (detail.teacher_credentials ?? []).map(toEditable)
}

async function addCredential() {
    if (!props.teacherId) return
    const platform = resolvePlatform(newCredential.value.platform, newCredential.value.customPlatform)
    const username = newCredential.value.username.trim()
    const password = newCredential.value.password.trim()
    if (!validCredential(platform, username, password)) return
    credentialSaving.value = true
    try {
        await TeacherService.addCredential({ teacher_id: props.teacherId, platform, username, password, url: newCredential.value.url.trim() })
        newCredential.value = emptyCredential()
        addCredentialOpen.value = false
        await refreshCredentials()
        success('teacher.credentials_add_success')
    } catch (error) { reportError(error, 'teacher.credentials_save_failed') } finally { credentialSaving.value = false }
}

async function updateCredential(credential: EditableCredential) {
    if (!credential.id) return
    const platform = resolvePlatform(credential.platformSelection, credential.customPlatform)
    const username = credential.username?.trim() || ''
    const password = credential.password?.trim() || ''
    if (!validCredential(platform, username, password)) return
    credentialSaving.value = true
    try {
        await TeacherService.updateCredential(credential.id, { platform, username, password, url: credential.url?.trim() || '' })
        await refreshCredentials()
        success('teacher.credentials_update_success')
    } catch (error) { reportError(error, 'teacher.credentials_save_failed') } finally { credentialSaving.value = false }
}

async function deleteCredential(credential: EditableCredential) {
    if (!credential.id) return
    credentialSaving.value = true
    try {
        await TeacherService.deleteCredential(credential.id)
        credentials.value = credentials.value.filter(item => item.id !== credential.id)
        success('teacher.credentials_delete_success')
    } catch (error) { reportError(error, 'teacher.credentials_save_failed') } finally { credentialSaving.value = false }
}

const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-50'
const labelClass = 'mb-1 block text-sm font-bold text-slate-700'
</script>

<template>
    <dialog ref="dialog" class="teacher-form-dialog m-auto w-[min(100vw-1rem,56rem)] max-h-[calc(100dvh-1rem)] rounded-2xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/50"
        :aria-labelledby="titleId" @close="emit('close')">
        <form class="flex max-h-[calc(100dvh-1rem)] flex-col" novalidate @submit.prevent="save">
            <header class="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                    <h2 :id="titleId" class="text-xl font-black">{{ isEditing ? t('teacher.edit_teacher') : t('teacher.add_teacher') }}</h2>
                    <p class="mt-1 text-sm text-slate-500">{{ isEditing ? t('teacher.edit_teacher_hint') : t('teacher.add_teacher_hint') }}</p>
                </div>
                <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    :aria-label="t('teacher.directory.form_dialog_close')" @click="emit('close')">
                    <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </header>

            <div class="flex-1 space-y-6 overflow-y-auto px-5 py-5" :aria-busy="loading">
                <p v-if="loading" role="status" class="py-10 text-center text-sm font-bold text-slate-400">{{ t('common.loading') }}</p>
                <template v-else>
                    <!-- Account link (create only; existing links change through "Manage account link"). -->
                    <section v-if="!isEditing" class="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <h3 class="text-sm font-black">{{ t('teacher.user_search_label') }}</h3>
                        <p class="text-xs text-slate-500">{{ t('teacher.add_teacher_hint') }}</p>
                        <div v-if="linkedAccount" class="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
                            <span class="min-w-0 truncate text-sm font-bold">{{ linkedAccount.display_name || linkedAccount.email }} <span class="font-normal text-slate-500">{{ linkedAccount.email }}</span></span>
                            <button type="button" class="min-h-11 shrink-0 rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100" @click="linkedAccount = null">{{ t('common.clear', '清除') }}</button>
                        </div>
                        <template v-else>
                            <div class="flex flex-col gap-2 sm:flex-row">
                                <label class="min-w-0 flex-1">
                                    <span class="sr-only">{{ t('teacher.user_search_label') }}</span>
                                    <input v-model="userQuery" type="search" :class="inputClass" :placeholder="t('teacher.user_search_placeholder')"
                                        autocomplete="off" @keydown.enter.prevent="searchUsers" />
                                </label>
                                <button type="button" class="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                                    :disabled="userSearching" @click="searchUsers">{{ userSearching ? t('teacher.user_search_loading') : t('teacher.user_search_button') }}</button>
                            </div>
                            <label class="inline-flex min-h-11 items-center gap-2 text-sm text-slate-700">
                                <input v-model="onlyUnlinked" type="checkbox" class="h-4 w-4 accent-emerald-600" />{{ t('teacher.filter_unlinked') }}
                            </label>
                            <p v-if="userMessage" class="text-sm text-slate-600" role="status">{{ userMessage }}</p>
                            <ul v-if="userResults.length" class="space-y-1">
                                <li v-for="result in userResults" :key="result.id">
                                    <button type="button" class="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm hover:border-emerald-300 hover:bg-emerald-50"
                                        @click="chooseAccount(result)">
                                        <span class="min-w-0 truncate"><span class="font-bold">{{ result.display_name || result.email }}</span> <span class="text-slate-500">{{ result.email }}</span></span>
                                        <span class="shrink-0 text-xs font-bold text-emerald-700">{{ t('teacher.user_search_select') }}</span>
                                    </button>
                                </li>
                            </ul>
                        </template>
                    </section>

                    <div class="grid gap-4 md:grid-cols-2">
                        <label class="block">
                            <span :class="labelClass">{{ t('teacher.name_label') }} <span class="text-rose-600" aria-hidden="true">*</span></span>
                            <input v-model="form.name" type="text" required maxlength="200" autocomplete="name" :class="inputClass" :placeholder="t('teacher.name_placeholder')" />
                        </label>
                        <template v-if="canEditSensitive">
                            <label class="block">
                                <span :class="labelClass">{{ t('teacher.email_label') }}</span>
                                <input v-model="form.email" type="email" autocomplete="email" :class="inputClass" :placeholder="t('teacher.email_placeholder')" />
                            </label>
                            <label class="block">
                                <span :class="labelClass">{{ t('teacher.phone_label') }}</span>
                                <input v-model="form.phone" type="tel" autocomplete="tel" :class="inputClass" :placeholder="t('teacher.phone_placeholder')" />
                            </label>
                            <label class="block">
                                <span :class="labelClass">{{ t('teacher.birthday_label') }}</span>
                                <input v-model="form.birthday" type="date" :class="inputClass" />
                            </label>
                            <label class="block">
                                <span :class="labelClass">{{ t('teacher.gov_id_label') }}</span>
                                <input v-model="form.gov_id" type="text" maxlength="20" autocomplete="off" :class="inputClass" :placeholder="t('teacher.gov_id_placeholder')" />
                            </label>
                            <label class="block md:col-span-2">
                                <span :class="labelClass">{{ t('teacher.address_label') }}</span>
                                <input v-model="form.address" type="text" autocomplete="street-address" :class="inputClass" :placeholder="t('teacher.address_placeholder')" />
                            </label>
                        </template>
                        <div class="md:col-span-2">
                            <p :class="labelClass">{{ t('teacher.bio_label') }}</p>
                            <TextEditor v-model="bioContent" preset="form" :min-height="112" :aria-label="t('teacher.bio_label')" :placeholder="t('teacher.bio_placeholder')" />
                        </div>
                    </div>

                    <section v-if="canEditSensitive" class="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4" aria-labelledby="teacher-credentials-title">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <h3 id="teacher-credentials-title" class="text-sm font-black">{{ t('teacher.credentials_title') }}</h3>
                                <p class="text-xs text-slate-500">{{ isEditing ? t('teacher.credentials_hint') : t('teacher.directory.credentials_after_create') }}</p>
                            </div>
                            <span v-if="isEditing" class="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700">{{ credentials.length }}</span>
                        </div>
                        <template v-if="isEditing">
                            <div v-for="credential in credentials" :key="credential.id" class="grid gap-2 rounded-xl border border-emerald-100 bg-white p-3 md:grid-cols-2">
                                <label class="block"><span :class="labelClass">{{ t('teacher.credentials_platform') }}</span>
                                    <select v-model="credential.platformSelection" :class="inputClass">
                                        <option v-for="option in platformOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                    </select>
                                </label>
                                <label v-if="credential.platformSelection === 'Other'" class="block"><span :class="labelClass">{{ t('teacher.credentials_platform_name') }}</span>
                                    <input v-model="credential.customPlatform" type="text" :class="inputClass" />
                                </label>
                                <label class="block"><span :class="labelClass">{{ t('teacher.credentials_username') }}</span>
                                    <input v-model="credential.username" type="text" autocomplete="off" :class="inputClass" />
                                </label>
                                <label class="block"><span :class="labelClass">{{ t('teacher.credentials_password') }}</span>
                                    <PasswordInput :model-value="credential.password ?? ''" autocomplete="new-password" :input-class="inputClass" :placeholder="t('teacher.credentials_password')" @update:model-value="credential.password = $event" />
                                </label>
                                <label class="block md:col-span-2"><span :class="labelClass">{{ t('teacher.credentials_url') }}</span>
                                    <input v-model="credential.url" type="url" :class="inputClass" />
                                </label>
                                <div class="flex gap-2 md:col-span-2 md:justify-end">
                                    <button type="button" class="min-h-11 rounded-xl border border-rose-200 px-4 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50" :disabled="credentialSaving" @click="deleteCredential(credential)">{{ t('common.delete') }}</button>
                                    <button type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50" :disabled="credentialSaving" @click="updateCredential(credential)">{{ t('common.save') }}</button>
                                </div>
                            </div>
                            <p v-if="!credentials.length" class="rounded-xl border border-dashed border-emerald-200 bg-white/70 px-3 py-4 text-center text-sm text-slate-500">{{ t('teacher.credentials_empty') }}</p>
                            <button type="button" data-testid="teacher-credential-add-toggle" class="flex min-h-11 w-full items-center justify-between rounded-xl border border-dashed border-emerald-300 bg-white px-3 text-sm font-black text-emerald-700 hover:bg-emerald-50"
                                :aria-expanded="addCredentialOpen" @click="addCredentialOpen = !addCredentialOpen">
                                <span>{{ t('teacher.credentials_add') }}</span>
                                <svg class="h-4 w-4 transition-transform motion-reduce:transition-none" :class="{ 'rotate-180': addCredentialOpen }" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7" /></svg>
                            </button>
                            <div v-if="addCredentialOpen" data-testid="teacher-credential-add-form" class="grid gap-2 rounded-xl border border-dashed border-emerald-200 bg-white p-3 md:grid-cols-2">
                                <label class="block"><span :class="labelClass">{{ t('teacher.credentials_platform') }}</span>
                                    <select v-model="newCredential.platform" :class="inputClass">
                                        <option value="" disabled>{{ t('teacher.directory.credentials_platform_select') }}</option>
                                        <option v-for="option in platformOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                                    </select>
                                </label>
                                <label v-if="newCredential.platform === 'Other'" class="block"><span :class="labelClass">{{ t('teacher.credentials_platform_name') }}</span>
                                    <input v-model="newCredential.customPlatform" type="text" :class="inputClass" />
                                </label>
                                <label class="block"><span :class="labelClass">{{ t('teacher.credentials_username') }}</span>
                                    <input v-model="newCredential.username" type="text" autocomplete="off" :class="inputClass" />
                                </label>
                                <label class="block"><span :class="labelClass">{{ t('teacher.credentials_password') }}</span>
                                    <PasswordInput v-model="newCredential.password" autocomplete="new-password" :input-class="inputClass" :placeholder="t('teacher.credentials_password')" />
                                </label>
                                <label class="block md:col-span-2"><span :class="labelClass">{{ t('teacher.credentials_url') }}</span>
                                    <input v-model="newCredential.url" type="url" :class="inputClass" />
                                </label>
                                <div class="flex gap-2 md:col-span-2 md:justify-end">
                                    <button type="button" class="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50" :disabled="credentialSaving" @click="addCredentialOpen = false; newCredential = emptyCredential()">{{ t('common.cancel') }}</button>
                                    <button type="button" class="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50" :disabled="credentialSaving" @click="addCredential">{{ t('teacher.credentials_add') }}</button>
                                </div>
                            </div>
                        </template>
                    </section>
                </template>
            </div>

            <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
                <button type="button" class="min-h-11 rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50" @click="emit('close')">{{ t('common.cancel') }}</button>
                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60" :disabled="saving || loading">
                    {{ saving ? t('common.saving') : t('common.save') }}
                </button>
            </footer>
        </form>
    </dialog>
</template>

<style scoped>
/* Keep scroll gestures in the dialog and over its backdrop from scrolling the page. */
.teacher-form-dialog:modal {
    overscroll-behavior: contain;
}
.teacher-form-dialog::backdrop {
    overflow: hidden;
    overscroll-behavior: contain;
}
.teacher-form-dialog[open] {
    display: block;
}
</style>
