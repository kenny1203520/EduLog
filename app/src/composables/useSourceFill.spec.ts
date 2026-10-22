import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { sourceFillChannel, useSourceFill } from './useSourceFill'

const CHANNEL = 'a'.repeat(32)
const REPORT = '00000000-0000-4000-8000-000000000001'
const PANEL = 'chrome-extension://caefagceiajdhjnmogiaicaijckmplge'
const panelOrigin = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/composables/useExtensionPanel', () => ({ extensionPanelOrigin: () => panelOrigin.value }))

// A real window stands in for the extension's panel page (the parent frame).
let panel: Window
function harness(channel: string | null) {
  let api!: ReturnType<typeof useSourceFill>
  const wrapper = mount(defineComponent({ setup() { api = useSourceFill(ref(channel)); return () => h('div') } }))
  return { wrapper, api: () => api }
}
const fromPanel = (data: unknown, origin = PANEL, source: Window = panel) => window.dispatchEvent(new MessageEvent('message', { data, origin, source }))
const posted = () => (panel.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls

describe('useSourceFill', () => {
  beforeEach(() => {
    const frame = document.body.appendChild(document.createElement('iframe'))
    panel = frame.contentWindow!
    vi.spyOn(panel, 'postMessage').mockImplementation(() => {})
    vi.spyOn(window, 'parent', 'get').mockReturnValue(panel as Window & typeof globalThis)
    panelOrigin.value = PANEL
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren() })

  it('accepts only a 32-hex channel from the query', () => {
    expect(sourceFillChannel(CHANNEL)).toBe(CHANNEL)
    expect(sourceFillChannel([CHANNEL])).toBe(CHANNEL)
    expect(sourceFillChannel('nope')).toBeNull()
    expect(sourceFillChannel(undefined)).toBeNull()
  })

  it('pings the extension panel and stays unavailable until it answers', () => {
    const { wrapper, api } = harness(CHANNEL)
    expect(api().bridgeReady.value).toBe(false)
    expect(posted()).toContainEqual([{ type: 'edulog:bridge-ping' }, PANEL])
    api().send(REPORT)
    expect(api().state.value).toBe('idle')
    fromPanel({ type: 'edulog:bridge-ready' })
    expect(api().bridgeReady.value).toBe(true)
    wrapper.unmount()
  })

  it('outside the extension panel there is nothing to talk to', () => {
    panelOrigin.value = null
    const { wrapper, api } = harness(CHANNEL)
    fromPanel({ type: 'edulog:bridge-ready' })
    expect(api().bridgeReady.value).toBe(false)
    expect(posted()).toEqual([])
    wrapper.unmount()
  })

  it('sends only the channel and report id to the panel origin, and follows the matching result', () => {
    const { wrapper, api } = harness(CHANNEL)
    fromPanel({ type: 'edulog:bridge-ready' })
    api().send(REPORT)
    expect(api().state.value).toBe('sending')
    expect(posted().at(-1)).toEqual([{ type: 'edulog:source-fill', channel: CHANNEL, reportId: REPORT }, PANEL])
    fromPanel({ type: 'edulog:source-fill-result', channel: 'b'.repeat(32), ok: true })
    expect(api().state.value).toBe('sending')
    fromPanel({ type: 'edulog:source-fill-result', channel: CHANNEL, ok: false, reason: 'SOURCE_CLOSED' })
    expect(api().state.value).toBe('failed')
    expect(api().reason.value).toBe('SOURCE_CLOSED')
    expect(api().result.value).toBeNull()
    wrapper.unmount()
  })

  it('keeps how many fields the extension filled, clamped to small whole numbers', () => {
    const { wrapper, api } = harness(CHANNEL)
    fromPanel({ type: 'edulog:bridge-ready' })
    api().send(REPORT)
    fromPanel({ type: 'edulog:source-fill-result', channel: CHANNEL, ok: true, applied: 4, skipped: 1e6, review: 'yes' })
    expect(api().state.value).toBe('sent')
    expect(api().result.value).toEqual({ applied: 4, skipped: 50, review: false })
    api().send(REPORT)
    expect(api().result.value).toBeNull()
    fromPanel({ type: 'edulog:source-fill-result', channel: CHANNEL, ok: true, applied: 1.5, review: true })
    expect(api().result.value).toEqual({ applied: 0, skipped: 0, review: true })
    wrapper.unmount()
  })

  it('ignores messages from other origins or windows and times out without an answer', () => {
    vi.useFakeTimers()
    const { wrapper, api } = harness(CHANNEL)
    fromPanel({ type: 'edulog:bridge-ready' })
    api().send(REPORT)
    fromPanel({ type: 'edulog:source-fill-result', channel: CHANNEL, ok: true }, 'https://evil.example')
    fromPanel({ type: 'edulog:source-fill-result', channel: CHANNEL, ok: true }, PANEL, window)
    expect(api().state.value).toBe('sending')
    vi.advanceTimersByTime(15000)
    expect(api().state.value).toBe('failed')
    expect(api().reason.value).toBe('TIMEOUT')
    wrapper.unmount()
  })
})
