import timeZoneIds from '@/data/timeZoneIds.json'

const fallbackTimeZone = 'Asia/Taipei'
const stableTimeZoneIds = timeZoneIds as string[]
const formatterCache = new Map<string, Intl.DateTimeFormat>()

function supportedIds(): string[] {
    const intlWithValues = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
    const runtimeIds = intlWithValues.supportedValuesOf?.('timeZone')
    return [...new Set(['UTC', ...(runtimeIds?.length ? runtimeIds : stableTimeZoneIds)])]
}

export interface TimeZoneOption {
    value: string
    label: string
    searchText: string
    description: string
}

export class TimeZoneService {
    private static formatter(locale: string, zone: string, name: NonNullable<Intl.DateTimeFormatOptions['timeZoneName']>) {
        const key = `${locale}|${zone}|${name}`
        let formatter = formatterCache.get(key)
        if (!formatter) {
            formatter = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: name })
            formatterCache.set(key, formatter)
        }
        return formatter
    }

    static getBrowserTimeZone(): string {
        const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
        return this.isValid(browserZone) ? browserZone : fallbackTimeZone
    }

    static getDefaultTimeZone(): string {
        const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('timeZone') : null
        if (stored && this.isValid(stored)) return stored
        return this.getBrowserTimeZone()
    }

    static isValid(zone: string | undefined): zone is string {
        if (!zone) return false
        try {
            new Intl.DateTimeFormat('en', { timeZone: zone }).format(0)
            return true
        } catch {
            return false
        }
    }

    static getSupportedTimeZones(): string[] {
        return supportedIds()
    }

    static getOffsetLabel(zone: string, locale = 'en', instant = new Date()): string {
        if (!this.isValid(zone)) return ''
        return this.formatter(locale, zone, 'shortOffset')
            .formatToParts(instant)
            .find(part => part.type === 'timeZoneName')?.value ?? ''
    }

    static getLocalizedName(zone: string, locale = 'en'): string {
        if (!this.isValid(zone)) return zone
        const formatter = this.formatter(locale, zone, 'longGeneric')
        const genericName = formatter.formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value
        if (genericName && genericName.toLowerCase() !== 'gmt') return genericName
        const longName = this.formatter(locale, zone, 'long')
            .formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value
        return longName || zone
    }

    static formatLabel(zone: string, locale = 'en'): string {
        const normalizedZone = this.isValid(zone) ? zone : this.getDefaultTimeZone()
        const name = this.getLocalizedName(normalizedZone, locale)
        const offset = this.getOffsetLabel(normalizedZone, locale)
        return offset ? `${name} (${offset})` : name
    }

    static getOptions(locale = 'en'): TimeZoneOption[] {
        const preferred = [
            'Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul', 'Asia/Singapore',
            'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Chicago',
            'America/Denver', 'America/Los_Angeles', 'UTC'
        ]
        const ids = this.getSupportedTimeZones()
        const ordered = [...preferred.filter(zone => ids.includes(zone)), ...ids.filter(zone => !preferred.includes(zone))]
        return ordered.map(value => {
            const label = this.formatLabel(value, locale)
            return { value, label, searchText: `${value} ${this.getLocalizedName(value, locale)}`, description: value }
        })
    }
}
