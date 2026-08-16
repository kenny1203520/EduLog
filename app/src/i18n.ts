import { createI18n } from 'vue-i18n'
import zhTW from './locales/zh-TW'
import en from './locales/en'

/** The languages this app actually ships UI translations for ('zh' is only an alias of 'zh-TW'). */
export type SupportedLocale = 'zh-TW' | 'en'

// $d(date, 'short'|'long') formats. Date-only vs. instant formatting still
// goes through DateUtils.displayDate/displayDateTime (it also handles
// time-zone-aware instants and YYYY-MM-DD "calendar day" carriers, which a
// plain DateTimeFormat preset can't distinguish) -- these presets exist for
// simple, non-time-zone-sensitive date displays that want $d() directly.
const datetimeFormats = {
  'en': {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' }
  },
  'zh-TW': {
    short: { year: 'numeric', month: 'short', day: 'numeric' },
    long: { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: 'numeric', minute: 'numeric' }
  }
} as const

// $n(value, 'decimal'|'percent') formats for the count/rate interpolations
// that today are inserted as bare numbers with no locale-aware grouping.
const numberFormats = {
  'en': {
    decimal: { style: 'decimal', maximumFractionDigits: 2 },
    percent: { style: 'percent', maximumFractionDigits: 1 }
  },
  'zh-TW': {
    decimal: { style: 'decimal', maximumFractionDigits: 2 },
    percent: { style: 'percent', maximumFractionDigits: 1 }
  }
} as const

const i18n = createI18n({
  legacy: false, // Use Composition API mode
  locale: 'zh-TW', // Default locale
  fallbackLocale: 'en',
  messages: {
    'zh-TW': zhTW,
    'zh': zhTW,
    'en': en
  },
  datetimeFormats: {
    'en': datetimeFormats.en,
    'zh-TW': datetimeFormats['zh-TW'],
    'zh': datetimeFormats['zh-TW']
  },
  numberFormats: {
    'en': numberFormats.en,
    'zh-TW': numberFormats['zh-TW'],
    'zh': numberFormats['zh-TW']
  }
})

export default i18n
