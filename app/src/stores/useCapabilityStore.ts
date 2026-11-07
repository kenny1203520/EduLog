import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { CapabilityService, type CapabilityMap } from '@/services/rbac/CapabilityService'

/**
 * Teaching capabilities of the signed-in user (navigation and action
 * visibility only; the API enforces every request).
 *
 * If the summary cannot be loaded the store fails open, so navigation looks
 * as it did before capability filtering and the API still answers 403.
 */
export const useCapabilityStore = defineStore('capabilities', () => {
    const grants = ref<CapabilityMap>({})
    const loaded = ref(false)
    const failed = ref(false)
    let loadPromise: Promise<void> | null = null

    /** Loads the summary once per session; concurrent callers share one request. */
    async function ensureLoaded() {
        if (loaded.value) return
        if (loadPromise) return loadPromise
        loadPromise = (async () => {
            try {
                grants.value = await CapabilityService.getMyCapabilities()
                failed.value = false
            } catch (error) {
                console.warn('Teaching capabilities could not be loaded', error)
                grants.value = {}
                failed.value = true
            } finally {
                loaded.value = true
                loadPromise = null
            }
        })()
        return loadPromise
    }

    /** True when the permission holds in any scope (or the summary is unavailable). */
    function can(key: string) {
        if (failed.value) return true
        return grants.value[key]?.any === true
    }

    /** True when the permission holds platform-wide (or the summary is unavailable). */
    function canPlatform(key: string) {
        if (failed.value) return true
        return grants.value[key]?.platform === true
    }

    function reset() {
        grants.value = {}
        loaded.value = false
        failed.value = false
        loadPromise = null
    }

    const ready = computed(() => loaded.value)

    return { grants, loaded, ready, failed, ensureLoaded, can, canPlatform, reset }
})
