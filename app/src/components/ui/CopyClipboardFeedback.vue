<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'

const props = defineProps<{
    loading: boolean
    loadFailed: boolean
    manualText: string
}>()
const emit = defineEmits<{ retry: []; dismiss: [] }>()
const manualField = useTemplateRef<HTMLTextAreaElement>('manualField')

watch(() => props.manualText, async value => {
    if (!value) return
    await nextTick()
    manualField.value?.focus()
    manualField.value?.select()
})
</script>

<template>
    <p v-if="loading" role="status" class="my-2 text-sm text-slate-600">
        {{ $t('common.copy_template_loading') }}
    </p>
    <div v-else-if="loadFailed" class="my-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span role="status">{{ $t('common.copy_template_default_fallback') }}</span>
        <button type="button" class="underline" @click="emit('retry')">{{ $t('common.copy_retry') }}</button>
    </div>
    <div v-if="manualText" class="my-2 flex flex-col items-start gap-2 text-sm text-slate-700">
        <label class="w-full">
            {{ $t('common.copy_manually') }}
            <textarea ref="manualField" class="mt-1 block w-full rounded-lg border border-slate-300 p-2"
                readonly rows="4" :value="manualText" />
        </label>
        <button type="button" class="underline" @click="emit('dismiss')">{{ $t('common.close') }}</button>
    </div>
</template>
