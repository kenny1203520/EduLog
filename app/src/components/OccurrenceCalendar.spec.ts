import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/components/OccurrenceCalendar.vue'), 'utf8').replace(/\r\n/g, '\n')

describe('OccurrenceCalendar attendance indicator colors', () => {
    it('uses green for attending, red for absent, amber for pending, and gray for neutral states', () => {
        expect(source).toContain("case 'late':\n            return 'bg-emerald-500'")
        expect(source).toContain("case 'excused':\n            return 'bg-red-500'")
        expect(source).toContain("case 'pending':\n            return 'bg-amber-500'")
        expect(source).toContain("case 'holiday':\n        case 'completed':\n        default:\n            return 'bg-gray-400'")
        expect(source).not.toContain("bg-emerald-400 opacity-50")
        expect(source).not.toContain("bg-rose-500")
    })
})
