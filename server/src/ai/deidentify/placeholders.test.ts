import { describe, expect, it } from 'vitest'
import { PlaceholderMap, placeholderSuffix, trimIncompleteToken } from './placeholders.js'

describe('placeholderSuffix', () => {
  it('counts like spreadsheet columns', () => {
    expect([0, 25, 26, 27].map(placeholderSuffix)).toEqual(['A', 'Z', 'AA', 'AB'])
  })
})

describe('PlaceholderMap', () => {
  it('reuses the token for the same key and numbers per kind', () => {
    const map = new PlaceholderMap()
    expect(map.assign('student', 's1', '王小明')).toBe('[學生A]')
    expect(map.assign('student', 's2', '陳大文')).toBe('[學生B]')
    expect(map.assign('student', 's1', '王小明')).toBe('[學生A]')
    expect(map.assign('teacher', 't1', '林雅婷')).toBe('[老師A]')
  })

  it('restores tokens reformatted by the model and reports unknown ones', () => {
    const map = new PlaceholderMap()
    map.assign('student', 's1', '王小明')
    map.assign('teacher', 't1', '林雅婷')

    const result = map.restore('[學生 A] 表現好，［老師A］很欣慰；[學生C] 也來了。')
    expect(result.text).toBe('王小明 表現好，林雅婷很欣慰；[學生C] 也來了。')
    expect(result.unresolved).toEqual(['[學生C]'])
  })

  it('holds back a token split across streaming chunks', () => {
    const map = new PlaceholderMap()
    map.assign('student', 's1', '王小明')
    expect(map.restoreStreaming('今天[學')).toBe('今天')
    expect(map.restoreStreaming('今天[學生A]很')).toBe('今天王小明很')
  })
})

describe('trimIncompleteToken', () => {
  it('keeps closed brackets and long bracketed prose', () => {
    expect(trimIncompleteToken('進度 [C→E] 完成')).toBe('進度 [C→E] 完成')
    expect(trimIncompleteToken('備註 [這是一段很長的括號說明文字')).toBe('備註 [這是一段很長的括號說明文字')
  })
})
