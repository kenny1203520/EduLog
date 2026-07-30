import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/SessionDetailsView.vue'), 'utf8')

describe('SessionDetails responsive and loading contract', () => {
    it('renders retry state separately from the initialized classroom content', () => {
        expect(source).toContain('v-if="occurrenceLoadError"')
        expect(source).toContain('@click="loadData"')
        expect(source).toContain('v-else class="grid gap-6')
    })

    it('uses actual adjacent occurrence navigation and disables boundaries', () => {
        expect(source).toContain("moveOccurrence('previous')")
        expect(source).toContain("moveOccurrence('next')")
        expect(source).toContain(':disabled="!previousOccurrence || isOccurrenceLoading"')
        expect(source).toContain(':disabled="!nextOccurrence || isOccurrenceLoading"')
        expect(source).not.toContain('moveWeek(')
    })

    it('keeps the session identity, metadata and display controls responsive', () => {
        expect(source).toContain('flex min-w-0 flex-col gap-4 xl:flex-row')
        expect(source).toContain('grid-cols-[minmax(0,1fr)_auto]')
        expect(source).toContain('grid-cols-[auto_minmax(0,1fr)]')
        expect(source).toContain('[overflow-wrap:anywhere]')
        expect(source).toContain('sm:max-w-md xl:w-[22rem]')
        expect(source).toContain("t('classroom.session_time_zone')")
        expect(source).toContain("t('common.display_time_zone')")
        expect(source).not.toContain('<div class="w-56">')
    })

    it('switches to split view only at xl and keeps a usable class column width', () => {
        expect(source).toContain("xl:grid-cols-[minmax(560px,1fr)_minmax(420px,560px)]")
        expect(source).toContain("'hidden xl:block': showSplitView")
        expect(source).not.toContain('lg:grid-cols-[minmax(0,1fr)_450px]')
        expect(source).toContain("window.matchMedia('(max-width: 1279px)')")
    })
})
