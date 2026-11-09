<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RichTextViewer from '@/components/text-editor/RichTextViewer.vue'
import { createTextEditorContent } from '@/components/text-editor/content'
import TeacherAssignmentsSection from '@/components/teacher/TeacherAssignmentsSection.vue'
import type { TeacherDirectoryItem } from '@/services/teacher/TeacherDirectoryService'

/** Details of the selected teacher with the actions the caller may take. */
const props = defineProps<{
    teacher: TeacherDirectoryItem
    canEdit: boolean
    canArchive: boolean
    canDelete: boolean
    canLinkAccount: boolean
    canAssign: boolean
    canReadContact: boolean
}>()

const emit = defineEmits<{
    (e: 'close'): void
    (e: 'edit'): void
    (e: 'link-account'): void
    (e: 'archive'): void
    (e: 'restore'): void
    (e: 'delete'): void
    (e: 'assignments-changed'): void
}>()

const { t } = useI18n()
const archived = computed(() => Boolean(props.teacher.archived_at))
const hasContact = computed(() => Boolean(props.teacher.email || props.teacher.phone))
const hasBio = computed(() => Boolean(props.teacher.bio_document || props.teacher.bio?.trim()))
</script>

<template>
    <article class="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby="teacher-detail-name">
        <header class="flex items-start gap-3 border-b border-slate-200 p-4 sm:p-5">
            <button type="button" class="-ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 lg:hidden"
                :aria-label="t('teacher.directory.back_to_list')" @click="emit('close')">
                <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.83 10l3.94 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd" /></svg>
            </button>
            <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-black"
                :class="archived ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'" aria-hidden="true">
                {{ teacher.name.trim().charAt(0).toUpperCase() || '?' }}
            </span>
            <div class="min-w-0 flex-1">
                <h2 id="teacher-detail-name" class="truncate text-lg font-black text-slate-900">{{ teacher.name }}</h2>
                <div class="mt-1 flex flex-wrap gap-1.5">
                    <span v-if="archived" class="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{{ t('teacher.directory.archived_badge') }}</span>
                    <span class="rounded-full px-2 py-0.5 text-xs font-bold" :class="teacher.user_id ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'">
                        {{ teacher.user_id ? t('teacher.directory.linked') : t('teacher.directory.unlinked') }}
                    </span>
                </div>
            </div>
            <button type="button" class="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 lg:flex"
                :aria-label="t('teacher.directory.close_detail')" @click="emit('close')">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </header>

        <div class="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5">
            <div v-if="canEdit || canArchive || canLinkAccount" class="flex flex-wrap gap-2">
                <button v-if="canEdit" type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white transition-colors hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    @click="emit('edit')">{{ t('teacher.directory.edit') }}</button>
                <button v-if="canLinkAccount" type="button" class="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click="emit('link-account')">{{ t('teacher.directory.account_manage') }}</button>
                <button v-if="canArchive && !archived" type="button" class="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click="emit('archive')">{{ t('teacher.directory.archive') }}</button>
                <button v-if="canArchive && archived" type="button" class="min-h-11 rounded-xl border border-emerald-200 px-4 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click="emit('restore')">{{ t('teacher.directory.restore') }}</button>
            </div>

            <section aria-labelledby="teacher-contact-title" class="space-y-2">
                <h3 id="teacher-contact-title" class="text-sm font-black text-slate-900">{{ t('teacher.directory.column_contact') }}</h3>
                <p v-if="!canReadContact && !hasContact" class="text-sm text-slate-500">{{ t('teacher.directory.contact_hidden') }}</p>
                <dl v-else-if="hasContact" class="grid gap-2 text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
                    <template v-if="teacher.email">
                        <dt class="font-bold text-slate-500">{{ t('teacher.email_label') }}</dt>
                        <dd class="min-w-0 break-words"><a :href="`mailto:${teacher.email}`" class="text-emerald-700 hover:underline">{{ teacher.email }}</a></dd>
                    </template>
                    <template v-if="teacher.phone">
                        <dt class="font-bold text-slate-500">{{ t('teacher.phone_label') }}</dt>
                        <dd><a :href="`tel:${teacher.phone}`" class="text-emerald-700 hover:underline">{{ teacher.phone }}</a></dd>
                    </template>
                </dl>
                <p v-else class="text-sm text-slate-500">{{ t('teacher.directory.no_contact') }}</p>
            </section>

            <TeacherAssignmentsSection :teacher-id="teacher.id" :teacher-name="teacher.name" :archived="archived"
                :can-assign="canAssign" @changed="emit('assignments-changed')" />

            <section aria-labelledby="teacher-bio-title" class="space-y-2">
                <h3 id="teacher-bio-title" class="text-sm font-black text-slate-900">{{ t('teacher.bio_label') }}</h3>
                <RichTextViewer v-if="hasBio" :content="createTextEditorContent(teacher.bio_document || teacher.bio || '')" class="text-sm text-slate-700" />
                <p v-else class="text-sm text-slate-500">{{ t('teacher.directory.no_bio') }}</p>
            </section>

            <div v-if="canDelete" class="border-t border-slate-100 pt-4">
                <button type="button" class="min-h-11 rounded-xl px-3 text-sm font-bold text-rose-600 transition-colors hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-600"
                    @click="emit('delete')">{{ t('teacher.directory.delete_permanent') }}</button>
            </div>
        </div>
    </article>
</template>
