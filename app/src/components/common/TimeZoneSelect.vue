<script setup lang="ts">
import { usePreferencesStore } from '@/stores/usePreferencesStore'

withDefaults(defineProps<{
    label?: string
    dense?: boolean
}>(), {
    label: '',
    dense: false
})

const preferences = usePreferencesStore()
</script>

<template>
    <label class="block min-w-0">
        <span v-if="label" class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
            {{ label }}
        </span>
        <select v-model="preferences.timeZone" :class="[
            'w-full rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-600 shadow-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none',
            dense ? 'px-3 py-2' : 'px-4 py-3'
        ]">
            <option v-for="option in preferences.timeZoneOptions" :key="option.value" :value="option.value">
                {{ option.label }}
            </option>
        </select>
    </label>
</template>
