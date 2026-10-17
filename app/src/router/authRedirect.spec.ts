import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { getSafePostLoginTarget } from './authRedirect'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/dashboard', name: 'dashboard', component: { template: '<div />' } },
    { path: '/dashboard/student/:id', name: 'student', component: { template: '<div />' } },
    { path: '/login', name: 'login', component: { template: '<div />' } },
    { path: '/account-disabled', name: 'account-disabled', component: { template: '<div />' } },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' }
  ]
})

describe('getSafePostLoginTarget', () => {
  it('preserves an internal route including query and hash', () => {
    expect(getSafePostLoginTarget('/dashboard/student/42?tab=reports#latest', router)).toBe('/dashboard/student/42?tab=reports#latest')
  })

  it.each(['https://outside.example', '//outside.example/path', '/login', '/account-disabled', '/unknown'])('falls back to the dashboard for unsafe or non-return destinations: %s', value => {
    expect(getSafePostLoginTarget(value, router)).toBe('/dashboard')
  })
})
