import { createI18n } from 'vue-i18n'
import zhTW from './locales/zh-TW'
import en from './locales/en'

const i18n = createI18n({
  legacy: false, // Use Composition API mode
  locale: 'zh-TW', // Default locale
  fallbackLocale: 'en',
  messages: {
    'zh-TW': zhTW,
    'en': en
  }
})

export default i18n
