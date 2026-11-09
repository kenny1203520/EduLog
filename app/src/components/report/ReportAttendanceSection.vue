<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import type { AttendanceStatus } from '@/models/ReportEditorSnapshot'

defineProps<{
    editorId: string
    disabled: boolean
    isSystemManagedAbsence: boolean
    systemManagedLabel: string
    showAbsenceError: boolean
}>()

const attendanceStatus = defineModel<AttendanceStatus>('attendanceStatus', { required: true })
const absenceReason = defineModel<string>('absenceReason', { required: true })

const { t } = useI18n()

const absenceReasonOptions = computed(() => [
    { label: t('report.editor.select_reason'), value: '' },
    ...([
        'busy_with_schoolwork',
        'school_event',
        'family_matter',
        'sick_or_injured',
        'reason_not_provided',
        'travel_abroad',
        'family_ceremony',
        'school_activity',
        'suspension',
        'other'
    ].map(key => ({
        label: t(`report.editor.absence_reasons.${key}`),
        value: key
    })))
])
</script>

<template>
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {{ $t('report.editor.attendance_title') }}
        </h4>

        <div data-collab-field="attendance" class="flex items-center gap-4 mb-3">
            <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="pending" v-model="attendanceStatus"
                    :disabled="disabled || isSystemManagedAbsence"
                    class="w-4 h-4 text-gray-400 border-gray-300 focus:ring-gray-400" />
                <span class="text-sm font-medium text-gray-700">{{ $t('attendance.pending') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="present" v-model="attendanceStatus"
                    :disabled="disabled || isSystemManagedAbsence"
                    class="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500" />
                <span class="text-sm font-medium text-gray-700">{{ $t('attendance.present') }}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" value="absent" v-model="attendanceStatus"
                    :disabled="disabled || isSystemManagedAbsence"
                    class="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500" />
                <span class="text-sm font-medium text-gray-700">{{ $t('attendance.absent') }}</span>
            </label>
        </div>

        <!-- Absence Reason (conditional) -->
        <div v-if="attendanceStatus === 'absent'" class="mt-3">
            <label :for="`${editorId}-absence-reason`" class="block text-sm font-medium text-gray-700 mb-2">
                {{ $t('report.editor.absence_reason_label') }} <span class="text-red-600">*</span>
            </label>

            <!-- System-managed absence reason (read-only) -->
            <div v-if="isSystemManagedAbsence"
                class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" fill="none"
                    viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div class="flex-1">
                    <p class="text-sm font-semibold text-amber-800">
                        {{ systemManagedLabel }}
                    </p>
                    <p class="text-xs text-amber-700 mt-1">
                        {{ $t('report.editor.system_managed_absence_notice',
                            'This absence is managed by the system and cannot be modified.') }}
                    </p>
                </div>
            </div>

            <!-- User-selectable absence reason -->
            <BaseDropdown v-else :id="`${editorId}-absence-reason`" v-model="absenceReason" :options="absenceReasonOptions" theme="red" />
            <p v-if="showAbsenceError && !isSystemManagedAbsence" class="mt-1 text-sm text-red-600">{{
                $t('report.editor.absence_reason_required') }}</p>
        </div>
    </div>
</template>
