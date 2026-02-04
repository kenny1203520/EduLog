/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register'

const updateSW = registerSW({
  onNeedRefresh() {
    // Show a toast or prompt to user
    console.log('New content available, click on reload button to update.')
    if (confirm('New content available. Reload?')) {
        updateSW(true)
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline')
  },
})
