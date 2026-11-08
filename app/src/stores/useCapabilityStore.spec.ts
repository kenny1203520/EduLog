import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { CapabilityService } from '@/services/rbac/CapabilityService'
import { useCapabilityStore } from './useCapabilityStore'

vi.mock('@/services/rbac/CapabilityService', () => ({
  CapabilityService: { getMyCapabilities: vi.fn() }
}))

describe('useCapabilityStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('separates any-scope grants from platform grants', async () => {
    vi.mocked(CapabilityService.getMyCapabilities).mockResolvedValue({
      'teaching.students.list': { any: true, platform: false },
      'teaching.courses.create': { any: false, platform: false },
    })
    const store = useCapabilityStore()
    await store.ensureLoaded()
    expect(store.can('teaching.students.list')).toBe(true)
    expect(store.canPlatform('teaching.students.list')).toBe(false)
    expect(store.can('teaching.courses.create')).toBe(false)
    expect(store.can('teaching.unknown')).toBe(false)
  })

  it('loads once for concurrent callers and reloads after reset', async () => {
    vi.mocked(CapabilityService.getMyCapabilities).mockResolvedValue({})
    const store = useCapabilityStore()
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])
    await store.ensureLoaded()
    expect(CapabilityService.getMyCapabilities).toHaveBeenCalledTimes(1)
    store.reset()
    await store.ensureLoaded()
    expect(CapabilityService.getMyCapabilities).toHaveBeenCalledTimes(2)
  })

  it('fails open when the summary cannot be loaded', async () => {
    vi.mocked(CapabilityService.getMyCapabilities).mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = useCapabilityStore()
    await store.ensureLoaded()
    expect(store.can('teaching.students.list')).toBe(true)
    expect(store.canPlatform('teaching.courses.create')).toBe(true)
  })
})
