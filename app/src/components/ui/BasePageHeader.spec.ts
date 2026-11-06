import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BasePageHeader from './BasePageHeader.vue'

describe('BasePageHeader.vue', () => {
    it('renders the title prop correctly', () => {
        const wrapper = mount(BasePageHeader, {
            props: {
                title: 'Test Title'
            }
        })
        expect(wrapper.text()).toContain('Test Title')
    })

    it('renders the subtitle if provided', () => {
        const wrapper = mount(BasePageHeader, {
            props: {
                title: 'Test Title',
                subtitle: 'Test Subtitle'
            }
        })
        expect(wrapper.text()).toContain('Test Subtitle')
    })

    it('renders overline if provided', () => {
        const wrapper = mount(BasePageHeader, {
            props: {
                title: 'Test Title',
                overline: 'Test Overline'
            }
        })
        expect(wrapper.text()).toContain('Test Overline')
    })

    it('renders slots correctly', () => {
        const wrapper = mount(BasePageHeader, {
            props: {
                title: 'Test Title'
            },
            slots: {
                icon: '<span class="icon-slot">Icon</span>',
                actions: '<button class="action-btn">Action</button>'
            }
        })
        expect(wrapper.find('.icon-slot').exists()).toBe(true)
        expect(wrapper.find('.action-btn').exists()).toBe(true)
    })
})
