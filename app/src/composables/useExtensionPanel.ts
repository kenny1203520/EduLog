// The EduLog extension shows this app in the browser side panel: a frame whose parent is the
// extension's panel page. Only exact extension origins may frame the app (frame-ancestors), and
// the browser reports the parent's origin in location.ancestorOrigins.
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/

export function extensionPanelOrigin(): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null
  const origin = window.location.ancestorOrigins?.[0]
  return origin && EXTENSION_ORIGIN.test(origin) ? origin : null
}

export const inExtensionPanel = () => extensionPanelOrigin() !== null
