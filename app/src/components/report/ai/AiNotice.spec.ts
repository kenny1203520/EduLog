import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import AiNotice from './AiNotice.vue'

const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn() }))
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: copyMock }))

beforeEach(() => {
    i18n.global.locale.value = 'zh-TW'
    copyMock.mockReset().mockResolvedValue(true)
})

describe('AiNotice', () => {
    it('shows the plain message and keeps the technical detail folded, with copy', async () => {
        const wrapper = mount(AiNotice, {
            props: { tone: 'error', live: 'alert', message: '這個模型目前被限流', detail: 'HTTP 429 – Rate limit exceeded' },
            global: { plugins: [i18n] },
        })
        expect(wrapper.attributes('role')).toBe('alert')
        expect(wrapper.find('details').attributes('open')).toBeUndefined()
        expect(wrapper.find('summary').text()).toBe('詳細原因')

        await wrapper.find('details button').trigger('click')
        await flushPromises()
        expect(copyMock).toHaveBeenCalledWith('HTTP 429 – Rate limit exceeded')
        expect(wrapper.find('details button').text()).toBe('已複製')
    })

    it('has no live role or detail section unless asked', () => {
        const wrapper = mount(AiNotice, { props: { message: '請先儲存報告' }, global: { plugins: [i18n] } })
        expect(wrapper.attributes('role')).toBeUndefined()
        expect(wrapper.find('details').exists()).toBe(false)
    })
})
