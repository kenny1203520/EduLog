<script setup lang="ts">
import { computed } from 'vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { TimeZoneService } from '@/services/TimeZoneService'
import SearchableSelect from '@/components/common/SearchableSelect.vue'

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

const emit = defineEmits<{ (event: 'update:modelValue', value: string): void }>()
const preferences = usePreferencesStore()
const internalValue = computed({
    get: () => props.modelValue !== undefined ? props.modelValue : preferences.timeZone,
    set: (value: string) => {
        if (props.modelValue !== undefined) emit('update:modelValue', value)
        else preferences.timeZone = value
    }
})
const options = computed(() => TimeZoneService.getOptions(preferences.locale))
const selectSize = computed(() => props.fontSizeClass || (props.dense ? 'text-xs' : 'text-base'))
</script>

<template>
    <label class="block min-w-0">
        <span v-if="label" class="mb-1 ml-1 block text-sm font-black uppercase tracking-widest text-gray-400">{{ label }}</span>
        <SearchableSelect v-model="internalValue" :options="options" :font-size-class="selectSize"
            :aria-label="label || $t('common.time_zone')" :placeholder="$t('settings.timezone.search_placeholder')" />
    </label>
</template>
