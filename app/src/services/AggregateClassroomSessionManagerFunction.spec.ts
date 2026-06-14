/// <reference types="node" />

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const functionSourcePath = resolve(
  process.cwd(),
  '../supabase/volumes/functions/aggregate-classroom-session-manager/index.ts'
)

function readFunctionSource() {
  return readFileSync(functionSourcePath, 'utf8')
}

describe('aggregate-classroom-session-manager edge function', () => {
  it('does not leave a new Set expression vulnerable to ASI call parsing', () => {
    const source = readFunctionSource()

    expect(source).not.toMatch(/new Set<[^>]+>\(\)\s*\r?\n\s*\(/)
  })

  it('only uses active hidden visibility preferences for visible and hidden filters', () => {
    const source = readFunctionSource()

    expect(source).toContain(".eq('is_hidden', true)")
    expect(source.indexOf(".eq('is_hidden', true)")).toBeLessThan(
      source.indexOf(".in('entity_type', ['classroom', 'class_session'])")
    )
  })
})
