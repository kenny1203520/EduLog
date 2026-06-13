import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePreferencesStore } from './usePreferencesStore'
import { AggregateService } from '@/services/AggregateService'
import { UserPreferenceService } from '@/services/UserPreferenceService'

// Mock dependencies
vi.mock('@/services/AggregateService', () => ({
  AggregateService: {
    getUserPreferencesAggregate: vi.fn()
  }
}))
vi.mock('@/services/UserPreferenceService', () => ({
  UserPreferenceService: {
    updateCurrentUserTimeZone: vi.fn(() => Promise.resolve())
  }
}))
vi.mock('@/i18n', () => ({
  default: {
    global: {
      locale: { value: 'zh-TW' }
    }
  }
}))

describe('usePreferencesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    // Reset DOM
    document.documentElement.style.fontSize = ''
  })

  it('initializes with default values', () => {
    const store = usePreferencesStore()
    expect(store.globalFontScale).toBe(100)
    expect(store.editorFontScale).toBe(100)
    expect(store.locale).toBe('zh-TW')
  })

  it('adjustGlobalScale respects bounds', () => {
    const store = usePreferencesStore()
    
    // Add 50
    store.adjustGlobalScale(50)
    expect(store.globalFontScale).toBe(150)
    
    // Attempt to exceed max 200 by adding 100
    store.adjustGlobalScale(100)
    expect(store.globalFontScale).toBe(150) // Ignores since 250 > 200
    
    // Decrease to min
    store.adjustGlobalScale(-80)
    expect(store.globalFontScale).toBe(70)
    
    // Attempt to go below min 70
    store.adjustGlobalScale(-10)
    expect(store.globalFontScale).toBe(70) // Ignores since 60 < 70
  })

  it('loadUserPreferences sets time zone', async () => {
    const store = usePreferencesStore()
    vi.mocked(AggregateService.getUserPreferencesAggregate).mockResolvedValue({
      preferences: { time_zone: 'America/New_York' },
      visibility: {}
    } as any)

    await store.loadUserPreferences()
    expect(store.timeZone).toBe('America/New_York')
  })
})
