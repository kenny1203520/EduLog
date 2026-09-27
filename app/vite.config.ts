import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import pkg from './package.json' with { type: 'json' }
import { buildHttpsOptions, buildSecurityHeaders, parseAllowedHosts } from './vite.security.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, path.resolve(import.meta.dirname, '..'), ''), ...process.env }
  const allowedHosts = parseAllowedHosts(env.EDULOG_ALLOWED_HOSTS)
  const securityHeaders = buildSecurityHeaders(env)
  const https = buildHttpsOptions(env)

  return {
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globIgnores: ['**/runtime-config.js']
        },
        devOptions: {
          enabled: true
        },
        includeAssets: ['favicon.svg', 'robots.txt', 'apple-touch-icon.png'],
        manifest: {
          name: 'EduLog',
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
        '@': path.resolve(import.meta.dirname, './src'),
      }
    },
    server: {
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      ...(https === undefined ? {} : { https }),
      headers: securityHeaders,
      proxy: {
          "/api": {
          target: env.EDULOG_API_DEV_TARGET || 'http://localhost:3000',
          changeOrigin: true,
          ws: true,
          secure: false,
          },
      },
    },
    preview: {
      ...(allowedHosts === undefined ? {} : { allowedHosts }),
      ...(https === undefined ? {} : { https }),
      headers: securityHeaders
    }
  }
})
