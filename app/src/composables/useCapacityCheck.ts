import { ref, computed, watch } from 'vue'
import { SessionService } from '@/services/session/SessionService'
import { DateUtils } from '@/utils/dateUtils'

export function useCapacityCheck(sessionIdRef: { value: string }, startDateRef: { value: string }, generateCountRef: { value: number }) {
    const maxEnrollment = ref(0)
    const capacity = ref(0)
    const isChecking = ref(false)
    const lastCheckedKey = ref('')

    const isFull = computed(() => capacity.value > 0 && maxEnrollment.value >= capacity.value)

    async function check() {
        const sessionId = sessionIdRef.value
        const startDate = startDateRef.value
        const count = generateCountRef.value

        if (!sessionId || !startDate || count <= 0) {
            maxEnrollment.value = 0
            capacity.value = 0
            return
        }

        const key = `${sessionId}-${startDate}-${count}`
        if (key === lastCheckedKey.value) return
        
        isChecking.value = true
        try {
            // Calculate end date based on start date and count
            // This is a simple approximation, or we can fetch it from SessionService if it supports it
            const start = DateUtils.parseLocalDate(startDate) || new Date(startDate)
            const end = new Date(start)
            // Assuming weekly classes, 7 days * (count - 1)
            end.setDate(start.getDate() + (count - 1) * 7)
            const endDate = DateUtils.formatLocalDate(end)

            const [max, sessionDetails] = await Promise.all([
                SessionService.getMaxEnrollmentInDateRange(sessionId, startDate, endDate),
                SessionService.getSessionDetails(sessionId)
            ])

            maxEnrollment.value = max
            capacity.value = sessionDetails.capacity || 0
            lastCheckedKey.value = key
        } catch (e) {
            console.error('Failed to check capacity:', e)
        } finally {
            isChecking.value = false
        }
    }

    watch([sessionIdRef, startDateRef, generateCountRef], () => {
        void check()
    }, { immediate: true })

    return {
        maxEnrollment,
        capacity,
        isChecking,
        isFull,
        check
    }
}
