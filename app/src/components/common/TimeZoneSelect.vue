<script setup lang="ts">
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
    label?: string
    dense?: boolean
    modelValue?: string
    fontSizeClass?: string
}>(), {
    label: '',
    dense: false,
    modelValue: undefined,
    fontSizeClass: ''
})

const emit = defineEmits(['update:modelValue'])

const preferences = usePreferencesStore()

const internalValue = computed({
    get: () => props.modelValue !== undefined ? props.modelValue : preferences.timeZone,
    set: (val) => {
        if (props.modelValue !== undefined) {
            emit('update:modelValue', val)
        } else {
            preferences.timeZone = val
        }
    }
})
</script>

<template>
    <label class="block min-w-0">
        <span v-if="label" class="text-sm font-black text-gray-400 uppercase tracking-widest ml-1 mb-1 block">
            {{ label }}
        </span>
        <select v-model="internalValue" :class="[
            'w-full rounded-xl border border-gray-200 bg-white font-bold shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all',
            dense ? 'px-3 py-2 text-xs text-gray-600' : 'px-4 py-3',
            fontSizeClass || (dense ? '' : 'text-base')
        ]">
            <option v-for="option in preferences.timeZoneOptions" :key="option.value" :value="option.value">
                {{ option.label }}
            </option>
        </select>
    </label>
</template>
