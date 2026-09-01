import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')

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
        const referencePanel = readFileSync(resolve(repoRoot, 'app/src/components/ReportReferencePanel.vue'), 'utf8')
        expect(courseService).toMatch(/getCourseOptions[\s\S]*?select\('id, subject, stage, display_name'/)
        expect(sessionService).toMatch(/getClassSessionOptions[\s\S]*?select\('id, name, classroom_id, course_ids'/)
        const optionsBlock = sessionService.slice(sessionService.indexOf('getClassSessionOptions'), sessionService.indexOf('createClassSession', sessionService.indexOf('getClassSessionOptions')))
        expect(optionsBlock).not.toContain('lessons')
        expect(optionsBlock).not.toContain('schedule_rules')
        expect(referencePanel).toContain('CourseCatalogService.getCourseOptions')
        expect(referencePanel).toContain('SessionService.getClassSessionOptions')
    })

    it('keeps the editor visible when collaboration is unavailable', () => {
        const editor = readFileSync(resolve(repoRoot, 'app/src/components/ReportEditor.vue'), 'utf8')
        expect(editor).not.toContain(':user="collaborationUser""')
        expect(editor).toContain('v-if="ready && ydoc"')
        expect(editor).toContain('v-else')
        expect(editor).toContain('dedupeKey:')
        expect(editor).toContain('collaboration_fallback')
    })

    it('does not reintroduce wildcard editor hot-path queries', () => {
        const files = [
            'app/src/services/report/ReportQueryService.ts',
            'app/src/services/report/ReportCommandService.ts',
            'app/src/services/report/ReportTemplateService.ts',
            'app/src/services/copy_template/CopyTemplateQueryService.ts',
            'app/src/services/course/CourseCatalogService.ts'
        ]
        const sources = files.map(file => readFileSync(resolve(repoRoot, file), 'utf8'))
        expect(sources[0]).toMatch(/getReport[\s\S]*?select\(REPORT_EDITOR_COLUMNS\)/)
        expect(sources[1]).not.toMatch(/\.select\(\)\s*\.single\(\)/)
        expect(sources[2]).not.toMatch(/\.select\(['\"]\*['\"]\)/)
        expect(sources[3]).not.toMatch(/\.select\(['\"]\*['\"]\)/)
        expect(sources[4]).toContain('id, course_id, title, sequence')
        expect(sources[3]).toContain('COPY_TEMPLATE_COLUMNS')
    })
})
