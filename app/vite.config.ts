import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import pkg from './package.json'
import { buildHttpsOptions, buildSecurityHeaders, parseAllowedHosts } from './vite.security'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, path.resolve(__dirname, '..'), ''), ...process.env }
  const allowedHosts = parseAllowedHosts(env.EDULOG_ALLOWED_HOSTS)
  const securityHeaders = buildSecurityHeaders(env)
  const https = buildHttpsOptions(env)

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        devOptions: {
          enabled: true
        },
        includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
        manifest: {
          name: 'EduLog - Tutor Report System',
          short_name: 'EduLog',
          description: 'Professional Tutor Report System for managing students, courses, and progress.',
          theme_color: '#10b981',
          background_color: '#ffffff',
          display: 'standalone',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      })
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    },
    server: {
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      ...(https === undefined ? {} : { https }),
      headers: securityHeaders
    },
    preview: {
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      ...(https === undefined ? {} : { https }),
      headers: securityHeaders
    }
  }
})
