import { describe, expect, it } from 'vitest'
import { TimeZoneService } from './TimeZoneService'

describe('TimeZoneService', () => {
    it('provides the complete runtime timezone list with a bundled fallback', () => {
        const zones = TimeZoneService.getSupportedTimeZones()
        expect(zones.length).toBeGreaterThan(400)
        expect(zones).toContain('UTC')
        expect(zones).toContain('Asia/Taipei')
        expect(zones).toContain('Pacific/Apia')
    })

    it('localizes every available timezone label and keeps IANA ids searchable', () => {
        const english = TimeZoneService.getOptions('en')
        const traditionalChinese = TimeZoneService.getOptions('zh-TW')
        const enTaipei = english.find(option => option.value === 'Asia/Taipei')!
        const zhTaipei = traditionalChinese.find(option => option.value === 'Asia/Taipei')!

        expect(enTaipei.label).toContain('GMT+8')
        expect(enTaipei.searchText).toContain('Asia/Taipei')
        expect(zhTaipei.label).not.toBe(enTaipei.label)
        expect(english.every(option => Boolean(option.label) && Boolean(option.searchText))).toBe(true)
    })

    it('formats daylight-saving offsets for the requested date', () => {
        expect(TimeZoneService.getOffsetLabel('America/New_York', 'en', new Date('2026-01-15T12:00:00Z'))).toBe('GMT-5')
        expect(TimeZoneService.getOffsetLabel('America/New_York', 'en', new Date('2026-07-15T12:00:00Z'))).toBe('GMT-4')
    })

    it('falls back to a valid zone for malformed stored identifiers', () => {
        expect(TimeZoneService.isValid('Not/A-Timezone')).toBe(false)
        expect(TimeZoneService.formatLabel('Not/A-Timezone', 'en')).not.toBe('Not/A-Timezone')
    })
})
