import { computed } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'

/** The signed-in user's display name (nickname first) and avatar initial. */
export function useAccountIdentity() {
    const auth = useAuthStore()
    const accountDisplayName = computed(() => auth.user?.nickname?.trim() || auth.user?.display_name?.trim() || auth.user?.full_name?.trim() || auth.user?.email || '')
    const accountInitial = computed(() => accountDisplayName.value.charAt(0).toLocaleUpperCase())
    return { accountDisplayName, accountInitial }
}
