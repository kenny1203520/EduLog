import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const files = [
    'src/layouts/MainLayout.vue',
    'src/views/LoginView.vue',
    'src/views/LandingView.vue',
    'src/views/SettingsView.vue'
]

describe('LanguageSwitcher integration contract', () => {
    it('uses the shared globe menu at all four language entry points', () => {
        for (const file of files) {
            const source = readFileSync(resolve(process.cwd(), file), 'utf8')
            expect(source).toContain('LanguageSwitcher')
            expect(source).not.toContain("preferences.locale = 'zh-TW'")
            expect(source).not.toContain("preferences.locale = 'en'")
        }
    })

    it('keeps the mobile landing entry visible and menu semantics accessible', () => {
        const landing = readFileSync(resolve(process.cwd(), 'src/views/LandingView.vue'), 'utf8')
        const component = readFileSync(resolve(process.cwd(), 'src/components/ui/LanguageSwitcher.vue'), 'utf8')
        expect(landing).not.toContain('hidden md:flex gap-1')
        expect(landing).toContain('flex shrink-0 items-center gap-2 sm:gap-3')
        expect(landing).toContain('flex min-h-11 items-center justify-center')
        expect(component).toContain('aria-haspopup="dialog"')
        expect(component).toContain('fixed inset-0 z-[9998] flex items-center justify-center')
        expect(component).toContain('w-full max-w-2xl')
        expect(component).toContain('role="radio"')
        expect(component).toContain("event.key === 'Escape'")
    })
})
