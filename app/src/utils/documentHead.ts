import { watch } from 'vue'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import i18n from '@/i18n'

const APP_NAME = 'EduLog'
const FALLBACK_DESCRIPTION_KEY = 'nav.subtitle'

function getCurrentLocale() {
  const locale = i18n.global.locale
  return typeof locale === 'string' ? locale : locale.value
}

function translate(key: string | undefined, fallback = '') {
  if (!key) return fallback

  const translated = i18n.global.t(key)
  return translated === key ? fallback : translated
}

function formatTitle(route: RouteLocationNormalizedLoaded) {
  const pageTitle = translate(route.meta.title as string | undefined)
  return pageTitle ? `${pageTitle} | ${APP_NAME}` : APP_NAME
}

function formatDescription(route: RouteLocationNormalizedLoaded) {
  const description = translate(route.meta.description as string | undefined)
  return description || translate(FALLBACK_DESCRIPTION_KEY, `${APP_NAME} - Tutor Report System`)
}

function upsertMetaTag(selector: string, attr: 'content', value: string) {
  let el = document.querySelector<HTMLMetaElement>(selector)

  if (!el) {
    el = document.createElement('meta')

    const name = selector.match(/name="([^"]+)"/)?.[1]
    const property = selector.match(/property="([^"]+)"/)?.[1]

    if (name) el.setAttribute('name', name)
    if (property) el.setAttribute('property', property)

    document.head.appendChild(el)
  }

  el.setAttribute(attr, value)
}

export function updateDocumentHead(route: RouteLocationNormalizedLoaded) {
  if (typeof document === 'undefined') return

  const locale = getCurrentLocale()
  const title = formatTitle(route)
  const description = formatDescription(route)

  document.documentElement.lang = locale
  document.title = title

  upsertMetaTag('meta[name="description"]', 'content', description)
  upsertMetaTag('meta[property="og:title"]', 'content', title)
  upsertMetaTag('meta[property="og:description"]', 'content', description)
  upsertMetaTag('meta[property="og:type"]', 'content', 'website')
  upsertMetaTag('meta[property="og:url"]', 'content', window.location.href)
  upsertMetaTag('meta[property="og:locale"]', 'content', locale.replace('-', '_'))
  upsertMetaTag('meta[name="twitter:card"]', 'content', 'summary_large_image')
  upsertMetaTag('meta[name="twitter:title"]', 'content', title)
  upsertMetaTag('meta[name="twitter:description"]', 'content', description)
}

export function setupDocumentHead(router: Router) {
  updateDocumentHead(router.currentRoute.value)

  router.afterEach((to) => {
    updateDocumentHead(to)
  })

  watch(getCurrentLocale, () => {
    updateDocumentHead(router.currentRoute.value)
  })
}
