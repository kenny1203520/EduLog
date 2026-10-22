import { reactive, watch } from 'vue'

// What the extension side panel keeps open or closed, remembered in this browser only.
// Storage can be unavailable (private windows, blocked site data): defaults are used then.
export type PanelToolbar = 'contact' | 'class' | 'learning'
export interface PanelUiState {
  calendarOpen: boolean
  progressOpen: boolean
  toolbars: Record<PanelToolbar, boolean>
}

const KEY = 'edulog.panelUi'
const defaults = (): PanelUiState => ({ calendarOpen: false, progressOpen: false, toolbars: { contact: false, class: false, learning: false } })

function read(): PanelUiState {
  const state = defaults()
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<PanelUiState> | null
    if (!saved || typeof saved !== 'object') return state
    if (typeof saved.calendarOpen === 'boolean') state.calendarOpen = saved.calendarOpen
    if (typeof saved.progressOpen === 'boolean') state.progressOpen = saved.progressOpen
    for (const name of Object.keys(state.toolbars) as PanelToolbar[]) {
      if (typeof saved.toolbars?.[name] === 'boolean') state.toolbars[name] = saved.toolbars[name]
    }
  } catch { /* Unreadable storage keeps the defaults. */ }
  return state
}

let shared: PanelUiState | null = null
export function usePanelUiState(): PanelUiState {
  if (shared) return shared
  shared = reactive(read())
  watch(shared, value => {
    try { localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* Not remembered this time. */ }
  }, { deep: true })
  return shared
}

/** Test hook: forget the shared state so the next call reads storage again. */
export function resetPanelUiStateForTests() { shared = null }
