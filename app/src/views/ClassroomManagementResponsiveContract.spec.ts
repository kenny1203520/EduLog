import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/ClassroomManagementView.vue'), 'utf8')
const cardStart = source.indexOf('<div v-for="session in sortedSessions"')
const cardEnd = source.indexOf('<div v-if="sortedSessions.length === 0"', cardStart)
const card = source.slice(cardStart, cardEnd)

const roomCardStart = source.indexOf('<div v-for="room in classrooms"')
const roomCardEnd = source.indexOf('<!-- Card Body -->', roomCardStart)
const roomCard = source.slice(roomCardStart, roomCardEnd)
describe('ClassroomManagement session card responsive contract', () => {
    it('starts with visible classrooms and sessions by default', () => {
        expect(source).toContain("const displayMode = ref<DisplayMode>('visible')")
        expect(source).toContain('classroomOverviewCounts')
        expect(source).toContain("displayMode = 'all'")
    })

    it('uses card width to switch metadata columns without crushing mobile content', () => {
        expect(card).toContain('class="session-card group min-w-0')
        expect(card).toContain('session-card__metadata')
        expect(source).toContain('container-type: inline-size')
        expect(source).toContain('@container (min-width: 26rem)')
        expect(card).not.toContain('formatScheduleSummary(session)')
    })

    it('renders actions separately and keeps type out of the schedule metadata row', () => {
        expect(card).toContain('mt-4 flex items-center justify-end gap-1 border-t')
        expect(card).toContain("session.session_type === 'camp'")
        expect(card).toContain('v-for="item in scheduleDisplayItems(session)"')
    })

    it('keeps the agreed information hierarchy and optional external link', () => {
        const schedule = card.indexOf("$t('classroom.schedule')")
        const classroom = card.indexOf("$t('student.internal_courses.classroom')")
        const timeZone = card.indexOf("$t('classroom.session_time_zone')")
        const capacity = card.indexOf("$t('classroom.capacity_short')")
        const courses = card.indexOf('session.course_ids?.length')
        const external = card.indexOf('v-if="session.external_link"')

        expect([schedule, classroom, timeZone, capacity, courses, external].every(index => index >= 0)).toBe(true)
        expect(schedule).toBeLessThan(classroom)
        expect(classroom).toBeLessThan(timeZone)
        expect(timeZone).toBeLessThan(capacity)
        expect(capacity).toBeLessThan(courses)
        expect(courses).toBeLessThan(external)
    })

    it('retains classroom, weekday and start-time list ordering', () => {
        expect(source).toContain('const roomCompare = roomA.localeCompare(roomB)')
        expect(source).toContain('if (dayA !== dayB) return dayA - dayB')
        expect(source).toContain("firstA?.start_time || a.start_time || ''")
    })

    it('keeps room edit, delete and visibility controls visible and touch sized', () => {
        expect(roomCard).toContain('always visible for mouse, keyboard, and touch')
        expect(roomCard).toContain('min-h-11 min-w-11')
        expect(roomCard).toContain(':aria-label="$t(\'common.edit\')"')
        expect(roomCard).toContain("$t('classroom.hide')")
        expect(roomCard).not.toContain('lg:opacity-0')
    })
})
