import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const editor = readFileSync(resolve(process.cwd(), 'src/components/ReportEditor.vue'), 'utf8')

describe('report editor offline protection contracts', () => {
    it('writes a device-local draft for every local edit and drops it once saved', () => {
        expect(editor).toMatch(/triggerAutoSave\(snapshot\)\s*\n\s*persistLocalDraft\(snapshot\)/)
        expect(editor).toMatch(/watch\(autoSaveStatus, \(status\) => \{\s*if \(status === 'saved'\) void localDraft\.discard\(props\.reportId\)/)
        expect(editor).toMatch(/replaceWithCanonicalReport[\s\S]*?localDraft\.discard\(props\.reportId\)/)
    })

    it('offers restore on the same version and merges through ConflictModal otherwise', () => {
        expect(editor).toContain('classifyDraftRecovery(')
        const restore = editor.slice(editor.indexOf('function restoreLocalDraft'), editor.indexOf('function discardLocalDraft'))
        expect(restore).toMatch(/recovery\.action === 'restore'[\s\S]*?applyDraftSnapshot\(draft\.snapshot\)/)
        expect(restore).toContain('mergeReportConflict(draft.baseSnapshot, draft.snapshot, serverReport, false)')
        expect(restore).toContain("emit('conflict', serverReport, snapshotToLocalReport(merged, draft.baseVersion))")
        expect(editor).toContain('data-testid="report-draft-restore"')
        expect(editor).toContain('data-testid="report-draft-discard"')
    })

    it('warns before unloading or navigating away with unsaved changes', () => {
        expect(editor).toContain("window.addEventListener('beforeunload', warnBeforeUnload)")
        expect(editor).toContain("window.removeEventListener('beforeunload', warnBeforeUnload)")
        const warn = editor.slice(editor.indexOf('function warnBeforeUnload'), editor.indexOf('onBeforeRouteLeave(async'))
        expect(warn).toMatch(/if \(!hasUnsavedChanges\.value && !isSaving\.value\) return/)
        expect(warn).toContain('event.preventDefault()')
        expect(editor).toMatch(/onBeforeRouteLeave\(async \(\) => \{[\s\S]*?window\.confirm\(t\('report\.editor\.leave_unsaved_confirm'\)\)/)
    })

    it('shows translated offline/retry status instead of raw English errors', () => {
        expect(editor).toContain("'report.editor.offline_saved_locally'")
        expect(editor).toContain("'report.editor.save_failed_retrying'")
        expect(editor).toContain('{{ saveErrorMessage || saveError }}')
        expect(editor).not.toMatch(/\{\{ saveError \}\}/)
    })
})
