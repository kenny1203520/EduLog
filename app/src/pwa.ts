/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register'
import { useAppUpdatePrompt } from './composables/useAppUpdatePrompt'

const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New content available, prompting for reload.')
    useAppUpdatePrompt().open(() => updateSW(true))
  },
  onOfflineReady() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('edulog:pwa-offline-ready'))
  },
})
