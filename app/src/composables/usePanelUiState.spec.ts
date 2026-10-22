import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { resetPanelUiStateForTests, usePanelUiState } from './usePanelUiState'

// An in-memory Storage, as in usePreferencesStore.spec.ts; `broken` makes every call throw.
const data = new Map<string, string>()
let broken = false
const fail = () => { if (broken) throw new Error('blocked') }
const storage: Storage = {
  get length() { return data.size },
  clear() { data.clear() },
  getItem(key) { fail(); return data.get(key) ?? null },
  key(index) { return [...data.keys()][index] ?? null },
  removeItem(key) { data.delete(key) },
  setItem(key, value) { fail(); data.set(key, value) },
}

describe('usePanelUiState', () => {
  beforeEach(() => { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }) })
  afterEach(() => { data.clear(); broken = false; resetPanelUiStateForTests() })

  it('starts collapsed and remembers changes in this browser', async () => {
    const state = usePanelUiState()
    expect(JSON.parse(JSON.stringify(state))).toEqual({ calendarOpen: false, progressOpen: false, toolbars: { contact: false, class: false, learning: false } })
    state.progressOpen = true
    state.toolbars.learning = true
    await nextTick()
    resetPanelUiStateForTests()
    const reloaded = usePanelUiState()
    expect(reloaded.progressOpen).toBe(true)
    expect(reloaded.toolbars.learning).toBe(true)
    expect(reloaded.calendarOpen).toBe(false)
  })

  it('ignores malformed values and storage that cannot be used', async () => {
    data.set('edulog.panelUi', '{"progressOpen":"yes","toolbars":{"class":1}}')
    expect(usePanelUiState()).toMatchObject({ progressOpen: false, toolbars: { class: false } })
    resetPanelUiStateForTests()
    broken = true
    const state = usePanelUiState()
    state.calendarOpen = true
    await nextTick()
    expect(state.calendarOpen).toBe(true)
  })
})
