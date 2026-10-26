<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
    modelValue: string
    id?: string
    autocomplete?: string
    placeholder?: string
    required?: boolean
    minlength?: number
    maxlength?: number
    disabled?: boolean
    inputClass?: string
}>(), { autocomplete: 'current-password', required: false, disabled: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const visible = ref(false)
</script>

<template>
    <div class="relative min-w-0">
        <input
            :id="id"
            :value="modelValue"
            :type="visible ? 'text' : 'password'"
            :autocomplete="autocomplete"
            :placeholder="placeholder"
            :required="required"
            :minlength="minlength"
            :maxlength="maxlength"
            :disabled="disabled"
            :class="[inputClass, 'pr-12']"
            @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
         :aria-label="placeholder"/>
        <button
            type="button"
            class="absolute inset-y-0 right-1 flex min-h-10 min-w-10 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 disabled:opacity-50"
            :disabled="disabled"
            :aria-label="visible ? t('common.hide_password') : t('common.show_password')"
            :aria-pressed="visible"
            @click="visible = !visible"
        >
            <svg v-if="visible" aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.2A10.8 10.8 0 0112 5c5.2 0 8.7 4.8 9.5 7-.3.8-1 1.9-2 3M6.2 6.2C4.2 7.6 2.9 9.8 2.5 12c.4 2.2 3.9 7 9.5 7 1.1 0 2.1-.2 3-.6" />
            </svg>
            <svg v-else aria-hidden="true" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
                <circle cx="12" cy="12" r="2.5" />
            </svg>
        </button>
    </div>
</template>
