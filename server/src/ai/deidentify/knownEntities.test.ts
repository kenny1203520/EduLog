import { describe, expect, it } from 'vitest'
import { buildKnownEntityRecognizers, deriveAliases, parseKnownEntityType } from './knownEntities.js'

describe('deriveAliases', () => {
  it('adds the given name for three-character student names', () => {
    expect(deriveAliases({ id: 's', kind: 'student', name: '王小明' })).toEqual(['王小明', '小明'])
  })

  it('treats four-character names as compound surnames and adds teacher forms', () => {
    expect(deriveAliases({ id: 't', kind: 'teacher', name: '歐陽娜娜' }))
      .toEqual(['歐陽娜娜', '娜娜', '歐陽娜娜老師', '娜娜老師', '歐陽老師'])
  })

  it('drops single-character aliases and leaves school names whole', () => {
    expect(deriveAliases({ id: 's', kind: 'student', name: '林森', aliases: ['森'] })).toEqual(['林森'])
    expect(deriveAliases({ id: 'x', kind: 'school', name: '仁愛國小' })).toEqual(['仁愛國小'])
  })
})

describe('buildKnownEntityRecognizers', () => {
  it('builds longest-first patterns without word boundaries', () => {
    const [recognizer] = buildKnownEntityRecognizers([{ id: 's', kind: 'student', name: '王小明', aliases: ['小明(明明)'] }])
    expect(recognizer.supported_language).toBe('zh')
    expect(parseKnownEntityType(recognizer.supported_entity)).toBe(0)
    expect(recognizer.patterns[0].regex).toBe('小明\\(明明\\)|王小明|小明')
    expect(new RegExp(recognizer.patterns[0].regex).exec('王小明今天很棒')?.[0]).toBe('王小明')
  })
})
