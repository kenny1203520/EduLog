import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SearchableSelect from './SearchableSelect.vue'

const options = [
    { value: 'room-a', label: 'Alpha Room' },
    { value: 'room-b', label: 'Beta Room' }
]

describe('SearchableSelect', () => {
    it('does not open while disabled', async () => {
        const wrapper = mount(SearchableSelect, {
            props: { modelValue: '', options, disabled: true },
            global: { mocks: { $t: (key: string) => key } }
        })

        await wrapper.find('[role="button"]').trigger('click')
        expect(wrapper.find('input').exists()).toBe(false)
    })

    it('filters options by entered text', async () => {
        const wrapper = mount(SearchableSelect, {
            props: { modelValue: '', options },
            global: { mocks: { $t: (key: string) => key } }
        })

        await wrapper.find('[role="button"]').trigger('click')
        await wrapper.find('input').setValue('beta')
        expect(wrapper.text()).toContain('Beta Room')
        expect(wrapper.text()).not.toContain('Alpha Room')
    })
})
