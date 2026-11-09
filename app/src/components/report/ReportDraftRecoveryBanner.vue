<script setup lang="ts">
// An unsaved draft of this report was kept on this device.
defineProps<{
    action: 'restore' | 'merge'
    time: string
}>()

const emit = defineEmits<{
    restore: []
    discard: []
}>()
</script>

<template>
    <div class="my-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        role="alert" data-testid="report-draft-recovery">
        <span class="min-w-0 flex-1">
            {{ action === 'merge'
                ? $t('report.editor.draft_recovery.merge_prompt', { time })
                : $t('report.editor.draft_recovery.restore_prompt', { time }) }}
        </span>
        <button type="button" data-testid="report-draft-restore" @click="emit('restore')"
            class="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700">
            {{ $t('report.editor.draft_recovery.restore') }}
        </button>
        <button type="button" data-testid="report-draft-discard" @click="emit('discard')"
            class="rounded-md px-3 py-1 font-medium text-amber-800 hover:bg-amber-100">
            {{ $t('report.editor.draft_recovery.discard') }}
        </button>
    </div>
</template>
