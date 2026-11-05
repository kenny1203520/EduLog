import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue() as any],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true,
    // Keep specs independent of local app/.env files: an empty value means unset.
    env: { VITE_API_V1_MODE: '', VITE_LEGACY_API_BASE_URL: '' },
  }
})
