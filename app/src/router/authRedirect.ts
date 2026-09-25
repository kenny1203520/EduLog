import type { Router } from 'vue-router'

const PUBLIC_AUTH_PATHS = new Set(['/login', '/account-disabled'])

export function getSafePostLoginTarget(value: unknown, router: Router) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f]/.test(value)) {
    return '/dashboard'
  }

  const resolved = router.resolve(value)
  const isCatchAll = resolved.matched.some(record => record.path === '/:pathMatch(.*)*')
  if (isCatchAll || PUBLIC_AUTH_PATHS.has(resolved.path)) return '/dashboard'

  return resolved.fullPath
}
