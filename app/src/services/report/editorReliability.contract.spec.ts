import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
// ReportEditor renders; its state machine lives in useReportEditorSession and its
// sections in their own components. The contracts cover all of them together.
const EDITOR_FILES = [
    'src/components/report/ReportEditor.vue',
    'src/composables/report/useReportEditorSession.ts',
    'src/components/report/ReportDraftRecoveryBanner.vue',
    'src/components/report/ReportAttendanceSection.vue',
    'src/components/report/ReportProgressCheck.vue',
]
const readEditor = () => EDITOR_FILES.map(file => readFileSync(resolve(process.cwd(), file), 'utf8')).join('\n')

describe('editor reliability contracts', () => {
    it('keeps the collaboration snapshot RPC lock-free and version guarded', () => {
        const migration = readFileSync(resolve(repoRoot, 'supabase/migrations/1000036_editor_collaboration_reliability.sql'), 'utf8')
        expect(migration).not.toMatch(/FOR\s+UPDATE/i)
        expect(migration).toContain('report.version = p_base_report_version')
        expect(migration).toContain('report_collab_docs.base_report_version <= EXCLUDED.base_report_version')
        expect(migration).toContain('occurrence_reports report')
    })

    it('keeps report reference options narrow', () => {
        const courseService = readFileSync(resolve(repoRoot, 'app/src/services/course/CourseCatalogService.ts'), 'utf8')
        const sessionService = readFileSync(resolve(repoRoot, 'app/src/services/session/SessionService.ts'), 'utf8')
        const referencePanel = readFileSync(resolve(repoRoot, 'app/src/components/report/ReportReferencePanel.vue'), 'utf8')
        expect(courseService).toContain("apiResourceClient.list<CourseDTO>")
        expect(sessionService).toMatch(/getClassSessionOptions[\s\S]*?apiResourceClient\.list<ClassSessionOption>\('class-sessions'/)
        const optionsBlock = sessionService.slice(sessionService.indexOf('getClassSessionOptions'), sessionService.indexOf('createClassSession', sessionService.indexOf('getClassSessionOptions')))
        expect(optionsBlock).not.toContain('lessons')
        expect(optionsBlock).not.toContain('schedule_rules')
        expect(referencePanel).toContain('CourseCatalogService.getCourseOptions')
        expect(referencePanel).toContain('SessionService.getAllClassSessionOptions')
    })

    it('counts the local session plus remote peers only when collaboration is ready', () => {
        const collab = readFileSync(resolve(repoRoot, 'app/src/composables/useReportCollab.ts'), 'utf8')
        const editor = readEditor()
        expect(collab).toContain('onlineParticipantCount')
        expect(collab).toContain('activePeers.value.length + 1')
        expect(editor).toContain('{{ onlineParticipantCount }} online')
    })
    it('keeps the editor visible when collaboration is unavailable', () => {
        const editor = readEditor()
        const collab = readFileSync(resolve(repoRoot, 'app/src/composables/useReportCollab.ts'), 'utf8')
        expect(editor).not.toContain(':user="collaborationUser""')
        expect(editor).toContain('v-if="ready && ydoc"')
        expect(editor).toContain('v-else')
        expect(editor).toContain('dedupeKey:')
        expect(editor).toContain('collaboration_disconnected')
        expect(editor).toContain('<RealtimeStatusBadge v-if="effectiveCollaborationEnabled"')
        expect(editor).toContain('@retry="reconnectCollaboration"')
        expect(collab).toContain('scheduleRetry()')
        expect(collab).toContain('connect, disconnect, reconnect, saveSnapshot')
        expect(collab).toContain('await connectionPromise')
        expect(collab).toContain('preserveDocument = false')
    })

    it('keeps system-managed attendance read-only and out of dirty mutations', () => {
        const editor = readEditor()
        const commandService = readFileSync(resolve(repoRoot, 'app/src/services/report/ReportCommandService.ts'), 'utf8')

        expect(editor).toContain(':disabled="disabled || isSystemManagedAbsence"')
        expect(editor).toContain('normalizeSystemManagedReason')
        // The dirty-payload rule moved to models/ReportEditorSnapshot; the editor passes the flag.
        expect(editor).toContain('includeAttendance: !isSystemManagedAbsence.value')
        expect(readFileSync(resolve(process.cwd(), 'src/models/ReportEditorSnapshot.ts'), 'utf8')).toContain('if (options.includeAttendance)')
        expect(editor).toContain('metaMap.set(\'attendanceStatus\', attendanceStatus.value)')
        expect(editor).toContain('never hydrate these two fields from a stale Yjs document')
        expect(commandService).toContain("error.code === 'SYSTEM_MANAGED_REPORT'")
        expect(commandService).toContain('reconcileV1SystemManagedSave')
        expect(commandService).toContain('delete nonAttendanceData.attendanceStatus')
    })

    it('hydrates editable attendance from committed API state instead of stale collaboration metadata', () => {
        const editor = readEditor()
        const attendanceInitialization = editor.slice(editor.indexOf('const shouldHydrateMeta ='), editor.indexOf("if (metaMap.has('classParticipation'))"))
        expect(attendanceInitialization).toContain("attendanceStatus.value = props.initialAttendanceStatus || 'pending'")
        expect(attendanceInitialization).toContain("metaMap.set('attendanceStatus', attendanceStatus.value)")
        expect(attendanceInitialization).not.toContain("metaMap.get('attendanceStatus')")
        expect(editor).toContain('collabMetaHydratedReportId !== reportKey || !hasUnsavedChanges.value')
        expect(editor).toContain('editor has local unsaved changes')
    })
    it('routes production collaboration through the same-origin API WebSocket', () => {
        const collab = readFileSync(resolve(repoRoot, 'app/src/composables/useReportCollab.ts'), 'utf8')
        expect(collab).toContain('new CollaborationProvider(undefined, doc')
        expect(collab).not.toContain('apiDataClient')
    })

    it('does not reintroduce wildcard editor hot-path queries', () => {
        const files = [
            'app/src/services/report/ReportQueryService.ts',
            'app/src/services/report/ReportCommandService.ts',
            'app/src/services/report/ReportTemplateService.ts',
            'app/src/services/copy-template/CopyTemplateQueryService.ts',
            'app/src/services/course/CourseCatalogService.ts'
        ]
        const sources = files.map(file => readFileSync(resolve(repoRoot, file), 'utf8'))
        expect(sources[1]).not.toMatch(/\.select\(\)\s*\.single\(\)/)
        expect(sources[2]).not.toMatch(/\.select\(['\"]\*['\"]\)/)
        expect(sources[3]).not.toMatch(/\.select\(['\"]\*['\"]\)/)
        expect(sources[4]).toContain("'lessons'")
    })
})
