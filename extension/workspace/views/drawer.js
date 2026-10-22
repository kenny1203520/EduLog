// Right-side drawers (MASTER §6.10). The detail drawer sits beside the list on wide
// screens and overlays with a scrim below 1024px; "wide" drawers always overlay.
const open = new Map()
const narrow = () => matchMedia('(max-width: 1023px)').matches

export function openDrawer(drawer, { scrim, host, wide = false, trigger = document.activeElement, onClose } = {}) {
  if (!drawer) return
  const state = open.get(drawer)
  if (state) { state.onClose = onClose || state.onClose; return }
  open.set(drawer, { scrim, host, wide, trigger, onClose })
  drawer.hidden = false
  if (scrim) scrim.hidden = false
  host?.classList.add('has-drawer')
  if (wide || narrow()) document.documentElement.classList.add('drawer-modal')
  requestAnimationFrame(() => { if (!drawer.contains(document.activeElement)) drawer.querySelector('h2')?.focus?.({ preventScroll: true }) })
}

export function closeDrawer(drawer, { restoreFocus = true } = {}) {
  const state = open.get(drawer)
  if (!state) return
  open.delete(drawer)
  drawer.hidden = true
  if (state.scrim) state.scrim.hidden = true
  state.host?.classList.remove('has-drawer')
  if (![...open.values()].some(item => item.wide || narrow())) document.documentElement.classList.remove('drawer-modal')
  state.onClose?.()
  if (restoreFocus && state.trigger?.isConnected) state.trigger.focus({ preventScroll: true })
}

export const isDrawerOpen = drawer => open.has(drawer)

/** Wire scrims, close buttons and Escape for every drawer in the page. */
export function installDrawers(root = document) {
  root.addEventListener('click', event => {
    const button = event.target.closest?.('[data-close-drawer]')
    if (button) { const drawer = button.closest('.drawer'); if (drawer) closeDrawer(drawer); return }
    for (const [drawer, state] of open) if (state.scrim && event.target === state.scrim) closeDrawer(drawer)
  })
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !open.size) return
    const top = [...open.keys()].at(-1)
    if (event.target.closest?.('select,[popover]')) return
    closeDrawer(top); event.preventDefault()
  })
}
