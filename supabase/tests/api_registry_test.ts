import { assert, assertEquals } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { collectionSort, permissionResource, resourceDefinitions } from '../volumes/functions/api-v1/resourceRegistry.ts'

Deno.test('resource registry is explicit and aliases share canonical tables', () => {
  for (const [name, definition] of Object.entries(resourceDefinitions)) {
    assert(definition.table.length > 0)
    assert(definition.select.includes('id,'))
    assert(!definition.select.includes('*'), `${name} must not use wildcard selects`)
    assert(definition.fields.every((field) => /^[a-z_]+$/.test(field)))
    assert(definition.sortable.length > 0)
  }
  assertEquals(resourceDefinitions['class-sessions'].table, resourceDefinitions.class_sessions.table)
  assertEquals(resourceDefinitions['report-templates'].table, resourceDefinitions.report_templates.table)
  assertEquals(permissionResource('report-templates'), 'templates')
})

Deno.test('resource registry validates sort fields and direction', () => {
  assertEquals(collectionSort('teachings', 'name:asc'), { field: 'name', ascending: true })
  assertEquals(collectionSort('teachings', 'created_at:desc'), { field: 'created_at', ascending: false })
  for (const value of ['unknown:asc', 'name:up']) {
    let failed = false
    try { collectionSort('teachings', value) } catch { failed = true }
    assert(failed, `expected invalid sort ${value}`)
  }
})
