import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Compact mode is the editor inside the extension side panel: only what the teacher fills in.
// The progress notes are their own component (ReportProgressCheck), read together with the editor.
const source = ['src/components/report/ReportEditor.vue', 'src/components/report/ReportProgressCheck.vue']
  .map(file => readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n'))
  .join('\n')

describe('ReportEditor compact mode (side panel)', () => {
  it('drops the title, delete, report link, source link and font stepper', () => {
    expect(source).toContain('<h3 v-if="!props.compact"')
    expect(source).toContain('v-if="props.reportId && !props.compact" @click="handleDeleteReport"')
    expect(source).toContain('<SourceReportLink v-if="!props.compact"')
    expect(source).toContain('<!-- Report External Link Input -->\n            <div v-if="!props.compact"')
    expect(source).toContain('<!-- Editor Font Size Stepper -->\n        <div v-if="!props.compact"')
  })

  it('puts status and tools on one row and collapses the progress notes into a summary', () => {
    expect(source).toContain(":class=\"props.compact ? 'mb-3 flex flex-wrap items-center gap-x-3 gap-y-1' : 'contents'\"")
    expect(source).toContain('data-testid="progress-summary"')
    expect(source).toContain('v-show="!props.compact || panelUi.progressOpen"')
  })

  it('keeps every formatting toolbar behind its own 格式 toggle', () => {
    for (const field of ['contact', 'class', 'learning']) {
      expect(source).toContain(`data-testid="format-toggle-${field}"`)
      expect(source.split(`:toolbar-visible="toolbarVisible('${field}')"`).length - 1).toBe(2)
    }
    expect(source).not.toContain(':toolbar-visible="preferences.editorSettings.toolbarVisible"')
    expect(source).toContain('props.compact ? panelUi.toolbars[field] : preferences.editorSettings.toolbarVisible')
  })

  it('does not request lesson-entry options in read-only mode or accept stale responses', () => {
    expect(source).toContain('if (props.disabled || !reportId || props.loading) {')
    expect(source).toContain('lessonEntryOptionsRequest += 1')
    expect(source).toContain('() => props.disabled], () => { void loadLessonEntryOptions() }')
  })
})
