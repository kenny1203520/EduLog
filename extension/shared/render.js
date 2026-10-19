// Tiny DOM helpers for extension pages (no build step, no framework).
// h('button', { class: 'btn', onclick }, 'Label') creates elements; list() keeps
// keyed children in order and reuses their nodes, so focus, scroll and form state
// survive re-renders.

const SVG = 'http://www.w3.org/2000/svg'

function append(parent, child) {
  if (child == null || child === false || child === true) return
  if (Array.isArray(child)) { for (const item of child) append(parent, item); return }
  parent.append(child instanceof Node ? child : String(child))
}

/**
 * Create an element. Props: `class`, `style` (object or string), `dataset` (object),
 * `on<event>` (listener), `attrs` (raw attributes), DOM properties (id, type, value,
 * checked, disabled, hidden, htmlFor…) and any `aria-*` / `data-*` / `role` attribute.
 * `null`, `undefined` and `false` props are skipped.
 */
export function h(tag, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { children.unshift(props); props = {} }
  const svg = tag === 'svg' || tag === 'path' || tag === 'circle' || tag === 'rect' || tag === 'use' || tag === 'ellipse'
  const node = svg ? document.createElementNS(SVG, tag) : document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue
    if (key === 'class') node.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value)
    else if (key === 'style') { if (typeof value === 'string') node.setAttribute('style', value); else Object.assign(node.style, value) }
    else if (key === 'dataset') { for (const [name, data] of Object.entries(value)) if (data != null) node.dataset[name] = data }
    else if (key === 'attrs') { for (const [name, data] of Object.entries(value)) if (data != null && data !== false) node.setAttribute(name, data === true ? '' : data) }
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
    else if (svg || key.startsWith('aria-') || key.startsWith('data-') || key === 'role' || key === 'for' || key === 'popover' || key === 'popovertarget') node.setAttribute(key, value === true ? '' : value)
    else node[key] = value
  }
  append(node, children)
  return node
}

/**
 * Keyed list update: `render(item, existing)` returns the node for an item. It is called
 * with the previous node for the same key so it can update in place (or return a new one).
 * Nodes of removed keys are dropped; order follows `items`.
 */
export function list(container, items, key, render) {
  const previous = new Map()
  for (const child of container.children) if (child.dataset.key != null) previous.set(child.dataset.key, child)
  let cursor = container.firstElementChild
  const kept = new Set()
  for (const item of items) {
    const id = String(key(item)), old = previous.get(id)
    const node = render(item, old) || old
    node.dataset.key = id; kept.add(node)
    if (old && old !== node) { if (old === cursor) cursor = old.nextElementSibling; old.remove() }
    if (node === cursor) cursor = cursor.nextElementSibling
    else container.insertBefore(node, cursor)
  }
  for (const child of [...container.children]) if (!kept.has(child)) child.remove()
  return container
}

// Lucide icons (ISC licence), 24×24 stroke paths; same set as docs/design/prototype.
const ICONS = {
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  'chev-right': '<path d="m9 18 6-6-6-6"/>',
  'chev-left': '<path d="m15 18-6-6 6-6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  sliders: '<path d="M21 4h-7"/><path d="M10 4H3"/><path d="M21 12h-9"/><path d="M8 12H3"/><path d="M21 20h-5"/><path d="M12 20H3"/><path d="M14 2v4"/><path d="M8 10v4"/><path d="M16 18v4"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.22-8.56"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
}

/** Inline Lucide icon; decorative unless a label is given. */
export function icon(name, className = '') {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false')
  svg.setAttribute('class', `ic ${className}`.trim())
  svg.innerHTML = ICONS[name] || ''
  return svg
}
