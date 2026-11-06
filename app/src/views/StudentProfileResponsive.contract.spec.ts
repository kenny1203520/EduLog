import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('student profile responsive contract', () => {
    const profile = read('src/views/StudentProfileView.vue')
    const enrollments = read('src/components/student/StudentEnrollments.vue')
    const credentials = read('src/components/student/StudentCredentials.vue')
    const contacts = read('src/components/student/StudentContacts.vue')
    const schools = read('src/components/student/StudentSchools.vue')
    const suspensions = read('src/components/student/StudentSuspensions.vue')

    it('delays the split layout until xl and protects long identity metadata', () => {
        expect(profile).toContain('xl:grid-cols-12')
        expect(profile).toContain('xl:col-span-8')
        expect(profile).toContain('xl:col-span-4')
        expect(profile).toContain('break-all font-mono')
        expect(profile).not.toContain('lg:grid-cols-12')
    })

    it('sizes course actions from their container instead of the viewport', () => {
        expect(enrollments).toContain('repeat(auto-fit, minmax(min(100%, 11rem), 1fr))')
        expect(enrollments).toContain('min-w-0 overflow-hidden')
        expect(enrollments).not.toContain('lg:grid-cols-3 2xl:grid-cols-5')
    })

    it('does not hide profile controls behind hover interactions', () => {
        for (const component of [credentials, contacts, schools, suspensions]) {
            expect(component).not.toContain('opacity-0 group-hover:opacity-100')
        }
        expect(credentials).toContain('min-h-11 min-w-11')
    })
})
