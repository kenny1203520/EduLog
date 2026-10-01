import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { createI18n } from 'vue-i18n'
import settings from '../../src/locales/zh-TW/settings.json'
import common from '../../src/locales/zh-TW/common.json'
import Connections from '../../src/components/settings/WebExtensionIntegrations.vue'
import '../../src/style.css'
const router = createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:Connections}]})
const app = createApp(Connections)
app.use(router).use(createI18n({legacy:false,locale:'zh-TW',messages:{'zh-TW':{settings,common}}}))
await router.isReady()
app.mount('#app')
