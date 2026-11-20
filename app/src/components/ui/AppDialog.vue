<script setup lang="ts">
import { onBeforeUnmount, onMounted, useId, useTemplateRef, watch } from 'vue'

/**
 * Native modal <dialog>: the browser provides the top layer, focus trap,
 * inert background and Escape handling. `dismissible: false` blocks Escape
 * and backdrop clicks for steps the user must finish or explicitly cancel.
 */
const props = withDefaults(defineProps<{ open: boolean; title: string; description?: string; dismissible?: boolean; size?: 'md' | 'lg' }>(), {
    description: undefined, dismissible: true, size: 'md',
})
const emit = defineEmits<{ close: [] }>()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()
const descriptionId = useId()

function sync(open: boolean) {
    const element = dialog.value
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
}
watch(() => props.open, sync, { flush: 'post' })
onMounted(() => sync(props.open))
onBeforeUnmount(() => { if (dialog.value?.open) dialog.value.close() })

function requestClose() {
    if (props.dismissible) emit('close')
}
function onCancel(event: Event) {
    event.preventDefault()
    requestClose()
}
function onBackdrop(event: MouseEvent) {
    if (event.target === dialog.value) requestClose()
}
</script>

<template>
    <dialog ref="dialog" :aria-labelledby="titleId" :aria-describedby="description ? descriptionId : undefined"
        class="app-dialog m-auto w-[calc(100%-2rem)] overflow-visible rounded-3xl bg-transparent p-0 text-gray-900 backdrop:bg-gray-950/50 backdrop:backdrop-blur-sm"
        :class="size === 'lg' ? 'max-w-2xl' : 'max-w-lg'" @cancel="onCancel" @click="onBackdrop">
        <div v-if="open" class="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
            <header class="mb-5 flex items-start justify-between gap-4">
                <div class="min-w-0">
                    <h2 :id="titleId" class="text-xl font-black leading-tight">{{ title }}</h2>
                    <p v-if="description" :id="descriptionId" class="mt-1 text-sm text-gray-600">{{ description }}</p>
                </div>
                <button v-if="dismissible" type="button" :aria-label="$t('common.close')"
                    class="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-500 transition-colors duration-200 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    @click="requestClose">
                    <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
            </header>
            <slot />
            <footer v-if="$slots.footer" class="mt-6 flex flex-wrap justify-end gap-2">
                <slot name="footer" />
            </footer>
        </div>
    </dialog>
</template>

<style scoped>
.app-dialog[open] {
    animation: app-dialog-in 180ms ease-out;
}
@keyframes app-dialog-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
}
@media (prefers-reduced-motion: reduce) {
    .app-dialog[open] { animation: none; }
}
</style>
