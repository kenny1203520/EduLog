import { describe, expect, it } from 'vitest'
import { REPORT_PROMPT_VERSION, assessReportContext, buildReportPrompt, type ReportPromptContext } from './reportPrompt.js'

const base: ReportPromptContext = {
  studentToken: '[學生A]',
  courseName: 'Scratch 程式設計',
  subject: '程式',
  stage: '階段 2',
  lessonTitle: '第 5 課 迴圈與角色移動',
  progressStart: 'C',
  progressEnd: 'E',
  isCompleted: true,
  attendance: 'present',
  participation: 4,
  behavior: 3,
  classNotes: '[學生A] 很快理解重複積木，第二關和 [學生B] 聊天分心。',
  previousReports: [{ date: '2026-10-13', content: '[學生A] 完成第 4 課。', participation: 5, behavior: 4 }],
}

describe('buildReportPrompt', () => {
  it('includes lesson facts, notes and history, and tags the prompt version', () => {
    const built = buildReportPrompt(base, { tone: 'warm', length: 'medium', extraInstructions: '多鼓勵' })
    expect(built.version).toBe(REPORT_PROMPT_VERSION)
    expect(built.system).toContain('溫暖')
    expect(built.system).toContain('150–300 字')
    expect(built.prompt).toContain('課程：Scratch 程式設計 / 程式 / 階段 2')
    expect(built.prompt).toContain('進度：C → E（本課已完成）')
    expect(built.prompt).toContain('課程參與：4/5')
    expect(built.prompt).toContain('- 2026-10-13（參與 5/5，秩序 4/5）：[學生A] 完成第 4 課。')
    expect(built.prompt).toContain('## 老師的額外指示\n多鼓勵')
  })

  it('omits empty optional blocks', () => {
    const built = buildReportPrompt({ ...base, draft: '  ', template: undefined, previousReports: [] }, { tone: 'concise', length: 'short' })
    expect(built.prompt).not.toContain('老師草稿')
    expect(built.prompt).not.toContain('報告樣板')
    expect(built.prompt).not.toContain('近期報告')
  })
})

describe('assessReportContext', () => {
  it('flags missing lesson title, thin notes and pending attendance', () => {
    expect(assessReportContext({ lessonTitle: '', classNotes: '很好', attendance: 'pending' }).map((w) => w.code))
      .toEqual(['missing_lesson_title', 'thin_class_notes', 'attendance_not_recorded'])
  })

  it('counts the focus field and draft towards enough material', () => {
    expect(assessReportContext({
      lessonTitle: '迴圈', classNotes: '很好', focus: '今天重點是巢狀迴圈與角色同步移動，學生能自己除錯並完成作品', attendance: 'present',
    })).toEqual([])
  })
})

describe('course line', () => {
  it('does not repeat subject and stage already in the display name', () => {
    const built = buildReportPrompt({ ...base, courseName: 'Scratch 程式設計 階段 2', subject: 'Scratch 程式設計', stage: '階段 2' }, { tone: 'warm', length: 'short' })
    expect(built.prompt).toContain('課程：Scratch 程式設計 階段 2\n')
  })
})
