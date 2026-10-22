import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const panel = vi.hoisted(() => ({ value: false }))
vi.mock('@/composables/useExtensionPanel', () => ({ inExtensionPanel: () => panel.value }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), RouterLink: { template: '<a><slot /></a>' } }))
vi.mock('@/stores/useAuthStore', () => ({ useAuthStore: () => ({ user: { nickname: 'Teacher' }, signOut: vi.fn() }) }))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ loadUserPreferences: vi.fn() }) }))
vi.mock('@/composables/useFeedback', () => ({ useFeedback: () => ({ info: vi.fn(), reportError: vi.fn() }) }))
// The logo is a public/ asset that the template compiler turns into an import.
vi.mock('/pwa-192x192.png', () => ({ default: '/pwa-192x192.png' }))

import MainLayout from './MainLayout.vue'

function render() {
  return mount(MainLayout, { global: { mocks: { $t: (key: string) => key }, stubs: { 'router-view': { template: '<div data-testid="content" />' }, 'router-link': { template: '<a><slot /></a>' }, LanguageSwitcher: true } } })
}

describe('MainLayout', () => {
  afterEach(() => { panel.value = false })

  it('shows the app navigation in a normal browser tab', () => {
    const wrapper = render()
    expect(wrapper.find('aside').exists()).toBe(true)
    expect(wrapper.find('main').classes()).toContain('pt-16')
    wrapper.unmount()
  })

  it('in the extension side panel shows only the content: no header, sidebar or menu toggle', () => {
    panel.value = true
    const wrapper = render()
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(wrapper.find('.lg\\:hidden.fixed.top-0').exists()).toBe(false)
    expect(wrapper.find('main').classes()).toContain('pt-0')
    expect(wrapper.find('main').classes()).not.toContain('pt-16')
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
