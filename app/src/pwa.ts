/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register'
import { useAppUpdatePrompt } from './composables/useAppUpdatePrompt'

const updateSW = registerSW({
  onNeedRefresh() {
    console.log('New content available, prompting for reload.')
    useAppUpdatePrompt().open(() => updateSW(true))
  },
  onOfflineReady() {
    console.log('App ready to work offline')
  },
})
