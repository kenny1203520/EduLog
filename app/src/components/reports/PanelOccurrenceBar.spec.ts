import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PanelOccurrenceBar from './PanelOccurrenceBar.vue'
import type { ClassOccurrence } from '@/models/ClassOccurrence'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'en' }, t: (key: string) => key }) }))
vi.mock('@/stores/usePreferencesStore', () => ({ usePreferencesStore: () => ({ timeZone: 'UTC' }) }))
vi.mock('@/utils/DateUtils', () => ({ DateUtils: { displayDate: (date: Date) => date.toISOString().slice(0, 10) } }))

const lesson = (id: string, date: string, status = 'scheduled') => ({ id, occurrenceDate: new Date(`${date}T00:00:00Z`), effectiveStartTime: '10:00:00', effectiveEndTime: '12:00:00', status }) as unknown as ClassOccurrence
const lessons = [lesson('a', '2026-10-18', 'present'), lesson('b', '2026-10-25'), lesson('c', '2026-11-01')]
const render = (selected: ClassOccurrence | null, calendarOpen = false) => mount(PanelOccurrenceBar, {
  props: { occurrences: lessons, selected, calendarOpen },
  global: { mocks: { $t: (key: string) => key }, stubs: { OccurrenceCalendar: { name: 'OccurrenceCalendar', props: ['compact'], template: '<div data-testid="calendar" />' } } },
})

describe('PanelOccurrenceBar', () => {
  it('shows date · time · status for the selected lesson', () => {
    const wrapper = render(lessons[1])
    expect(wrapper.get('[data-testid="panel-occurrence-label"]').text()).toBe('2026-10-25 · 10:00–12:00 · attendance.scheduled')
  })

  it('steps to the previous and next lesson and disables the ends', async () => {
    const middle = render(lessons[1])
    await middle.get('[data-testid="panel-previous"]').trigger('click')
    await middle.get('[data-testid="panel-next"]').trigger('click')
    expect(middle.emitted('select-occurrence')?.map(([occurrence]) => (occurrence as ClassOccurrence).id)).toEqual(['a', 'c'])
    expect(render(lessons[0]).get('[data-testid="panel-previous"]').attributes('disabled')).toBeDefined()
    expect(render(lessons[2]).get('[data-testid="panel-next"]').attributes('disabled')).toBeDefined()
  })

  it('opens the compact calendar and closes it after a pick', async () => {
    const closed = render(lessons[1])
    expect(closed.find('[data-testid="calendar"]').exists()).toBe(false)
    await closed.get('[data-testid="panel-calendar-toggle"]').trigger('click')
    expect(closed.emitted('update:calendarOpen')).toEqual([[true]])

    const open = render(lessons[1], true)
    const calendar = open.getComponent({ name: 'OccurrenceCalendar' })
    expect(calendar.props('compact')).not.toBe(false)
    calendar.vm.$emit('select-occurrence', lessons[2])
    expect(open.emitted('select-occurrence')?.[0][0]).toBe(lessons[2])
    expect(open.emitted('update:calendarOpen')).toEqual([[false]])
  })

  it('asks for the homework check', async () => {
    const wrapper = render(lessons[1])
    await wrapper.get('[data-testid="panel-koding-check"]').trigger('click')
    expect(wrapper.emitted('koding-check')).toHaveLength(1)
  })
})
