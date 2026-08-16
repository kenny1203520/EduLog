import { ref } from 'vue'

// Module-scoped (not per-call) state: pwa.ts runs outside any component and
// needs to hand off "a new version is ready" to a component that can actually
// render a modal (App.vue). A shared singleton is the simplest way to bridge
// that gap without a Pinia store just for one boolean and one callback.
const isOpen = ref(false)
let pendingConfirm: (() => void) | null = null

export function useAppUpdatePrompt() {
    function open(onConfirm: () => void) {
        pendingConfirm = onConfirm
        isOpen.value = true
    }

    function confirm() {
        isOpen.value = false
        pendingConfirm?.()
        pendingConfirm = null
    }

    function dismiss() {
        isOpen.value = false
        pendingConfirm = null
    }

    return { isOpen, open, confirm, dismiss }
}
