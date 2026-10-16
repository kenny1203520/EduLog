import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RealtimeStatusBadge from './RealtimeStatusBadge.vue'

const base = { label: '重新連線中', message: '即時協作已中斷。', statusLabel: '即時協作連線狀態' }

describe('RealtimeStatusBadge', () => {
    it('keeps a fixed-size badge and shows details only in the popover', async () => {
        const wrapper = mount(RealtimeStatusBadge, { props: { ...base, tone: 'warning', canRetry: true, retryLabel: '重新連線', detail: 'socket closed' }, attachTo: document.body })
        const badge = wrapper.get('button')
        expect(badge.classes()).toContain('min-w-[8.5rem]')
        expect(badge.attributes('aria-expanded')).toBe('false')
        expect(wrapper.text()).not.toContain('socket closed')

        await badge.trigger('click')
        expect(badge.attributes('aria-expanded')).toBe('true')
        expect(wrapper.text()).toContain('即時協作已中斷。')
        expect(wrapper.text()).toContain('socket closed')

        await wrapper.findAll('button')[1]!.trigger('click')
        expect(wrapper.emitted('retry')).toHaveLength(1)
        wrapper.unmount()
    })

    it('recolors by tone without a retry action when not retryable', async () => {
        const wrapper = mount(RealtimeStatusBadge, { props: { ...base, tone: 'live', label: '即時協作' } })
        expect(wrapper.get('button').classes()).toContain('bg-emerald-50')
        await wrapper.get('button').trigger('click')
        expect(wrapper.findAll('button')).toHaveLength(1)
    })
})
