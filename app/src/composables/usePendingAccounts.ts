import { ref } from 'vue'
import { AccountApprovalService } from '@/services/auth/AccountApprovalService'

/** Shared count of accounts waiting for approval: the sidebar badge and the review panel both use it. */
const count = ref(0)
const canReview = ref(false)
let inFlight: Promise<void> | null = null

export function usePendingAccounts() {
    function refresh() {
        inFlight ??= AccountApprovalService.pendingCount()
            .then((result) => { count.value = result.count; canReview.value = result.can_review })
            .catch(() => { /* The badge is a hint; leave the last value. */ })
            .finally(() => { inFlight = null })
        return inFlight
    }
    function set(next: number) { count.value = next }
    return { count, canReview, refresh, set }
}
