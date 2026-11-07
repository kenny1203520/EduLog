import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

/** State for one ConfirmModal whose confirm button runs an async action. */
export function useConfirmDialog() {
    const { t } = useI18n()
    const confirmState = ref({
        isOpen: false,
        title: '',
        message: '',
        confirmText: '',
        isDangerous: false,
        isLoading: false,
        action: null as (() => unknown) | null
    })

    function openConfirm(title: string, message: string, action: () => unknown, isDangerous = false) {
        confirmState.value = {
            isOpen: true,
            title,
            message,
            confirmText: t('common.confirm', 'Confirm'),
            isDangerous,
            isLoading: false,
            action
        }
    }

    /** Runs the action; the dialog closes only when it succeeds. */
    async function handleConfirmAction() {
        if (confirmState.value.action) {
            try {
                confirmState.value.isLoading = true
                await confirmState.value.action()
                confirmState.value.isOpen = false
            } catch (e) {
                console.error(e)
            } finally {
                confirmState.value.isLoading = false
            }
        } else {
            confirmState.value.isOpen = false
        }
    }

    return { confirmState, openConfirm, handleConfirmAction }
}
