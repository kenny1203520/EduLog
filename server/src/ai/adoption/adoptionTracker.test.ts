import { describe, expect, it } from 'vitest'
import { computeMeasurements, restoreSnapshot, retainedRatio, type EntityNames } from './adoptionTracker.js'

const names: EntityNames = {
  studentId: 's1',
  students: new Map([['s1', '王小明'], ['s2', '陳大文']]),
  others: new Map([['t1', '林雅婷']]),
}
const refs = { '[學生A]': 's1', '[學生B]': 's2', '[老師A]': 't1' }

describe('retainedRatio', () => {
  it('is 1 when the adopted text is kept, even with text added around it', () => {
    expect(retainedRatio('孩子完成了迴圈練習。', '開頭補一句。孩子完成了迴圈練習。\n結尾也補一句')).toBe(1)
  })

  it('ignores whitespace and drops as text is rewritten or deleted', () => {
    expect(retainedRatio('孩子 完成了\n迴圈練習', '孩子完成了迴圈練習')).toBe(1)
    const partly = retainedRatio('孩子完成了迴圈練習，表現很好', '孩子完成了迴圈練習')
    expect(partly).toBeGreaterThan(0.5)
    expect(partly).toBeLessThan(1)
    expect(retainedRatio('孩子完成了迴圈練習', '今天請假')).toBeLessThan(0.2)
  })
})

describe('restoreSnapshot', () => {
  it('restores the student and teacher and shows classmates as 同學', () => {
    expect(restoreSnapshot('[學生A]和[學生B]聊天，[老師A]提醒，電話[電話A]', refs, names)).toBe('王小明和同學聊天，林雅婷提醒，電話[電話A]')
  })
})

describe('computeMeasurements', () => {
  const rows = [
    { id: 'a1', sanitized_snapshot: '[學生A]完成迴圈。', measured_from: null, knownRefs: refs },
    { id: 'a2', sanitized_snapshot: '[學生A]表現穩定。', measured_from: 'push' as const, knownRefs: refs },
  ]

  it('keeps push measurements final when a later save happens', () => {
    expect(computeMeasurements(rows, '王小明完成迴圈。', names, 'save')).toEqual([{ id: 'a1', final_similarity: 1 }])
  })

  it('re-measures everything on push', () => {
    expect(computeMeasurements(rows, '王小明完成迴圈。', names, 'push').map((row) => row.id)).toEqual(['a1', 'a2'])
  })
})
