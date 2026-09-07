import { assert, assertEquals } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { collectionSort, resourceDefinitions } from '../volumes/functions/api-v1/resourceRegistry.ts'

Deno.test('system resources have explicit allowlists and safe operations', () => {
  const roles = resourceDefinitions.roles
  const permissions = resourceDefinitions.permissions
  const audit = resourceDefinitions['audit-events']

  assertEquals(roles.domain, 'system')
  assertEquals(roles.methods, ['GET', 'POST', 'PATCH', 'DELETE'])
  assert(roles.select.includes('id,code,name'))
  assert(!roles.select.includes('*'))
  assertEquals(permissions.methods, ['GET'])
  assertEquals(audit.methods, ['GET'])
  assertEquals(permissions.permissionResource, 'permissions')
  assertEquals(audit.permissionResource, 'audit')
})

Deno.test('system collection sorting has a deterministic default and rejects unknown fields', () => {
  assertEquals(collectionSort('roles', null), { field: 'created_at', ascending: false })
  assertEquals(collectionSort('permissions', 'domain:asc'), { field: 'domain', ascending: true })
  assertEquals(collectionSort('audit-events', 'created_at:desc'), { field: 'created_at', ascending: false })
  let failed = false
  try { collectionSort('audit-events', 'metadata:asc') } catch { failed = true }
  assert(failed)
})
