import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { sourceFillChannel, useSourceFill } from './useSourceFill'

const CHANNEL = 'a'.repeat(32)
const REPORT = '00000000-0000-4000-8000-000000000001'

function harness(channel: string | null) {
  let api!: ReturnType<typeof useSourceFill>
  const wrapper = mount(defineComponent({ setup() { api = useSourceFill(ref(channel)); return () => h('div') } }))
  return { wrapper, api: () => api }
}
const fromPage = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window }))
const posted = () => (window.postMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.map(call => call[0])

describe('useSourceFill', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); delete document.documentElement.dataset.edulogBridge })

  it('accepts only a 32-hex channel from the query', () => {
    expect(sourceFillChannel(CHANNEL)).toBe(CHANNEL)
    expect(sourceFillChannel([CHANNEL])).toBe(CHANNEL)
    expect(sourceFillChannel('nope')).toBeNull()
    expect(sourceFillChannel(undefined)).toBeNull()
  })

  it('stays unavailable until the extension bridge announces itself', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const { wrapper, api } = harness(CHANNEL)
    expect(api().bridgeReady.value).toBe(false)
    expect(posted()).toContainEqual({ type: 'edulog:bridge-ping' })
    api().send(REPORT)
    expect(api().state.value).toBe('idle')
    fromPage({ type: 'edulog:bridge-ready' })
    expect(api().bridgeReady.value).toBe(true)
    wrapper.unmount()
  })

  it('sends only the channel and report id, and follows the matching result', () => {
    document.documentElement.dataset.edulogBridge = 'ready'
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const { wrapper, api } = harness(CHANNEL)
    api().send(REPORT)
    expect(api().state.value).toBe('sending')
    expect(posted().at(-1)).toEqual({ type: 'edulog:source-fill', channel: CHANNEL, reportId: REPORT })
    fromPage({ type: 'edulog:source-fill-result', channel: 'b'.repeat(32), ok: true })
    expect(api().state.value).toBe('sending')
    fromPage({ type: 'edulog:source-fill-result', channel: CHANNEL, ok: false, reason: 'SOURCE_CLOSED' })
    expect(api().state.value).toBe('failed')
    expect(api().reason.value).toBe('SOURCE_CLOSED')
    wrapper.unmount()
  })

  it('ignores messages from other windows and times out without an answer', () => {
    vi.useFakeTimers()
    document.documentElement.dataset.edulogBridge = 'ready'
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    const { wrapper, api } = harness(CHANNEL)
    api().send(REPORT)
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'edulog:source-fill-result', channel: CHANNEL, ok: true }, origin: 'https://evil.example', source: window }))
    expect(api().state.value).toBe('sending')
    vi.advanceTimersByTime(15000)
    expect(api().state.value).toBe('failed')
    expect(api().reason.value).toBe('TIMEOUT')
    wrapper.unmount()
  })
})
