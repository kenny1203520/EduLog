<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { apiV1Client } from '@/services/api/ApiV1Client'
import type { SettingsOverview } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'

const TeachingSettingsPanel = defineAsyncComponent(() => import('@/components/settings/TeachingSettingsPanel.vue'))
const SystemSettingsPanel = defineAsyncComponent(() => import('@/components/settings/SystemSettingsPanel.vue'))
const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const { reportError } = useFeedback()
const search = ref('')
const loading = ref(true)
const overview = ref<SettingsOverview | null>(null)
const dirty = ref(false)
const requestedTab = computed(() => { const value = typeof route.query.tab === 'string' ? route.query.tab : 'personal'; return ['personal', 'teaching', 'system'].includes(value) ? value as 'personal' | 'teaching' | 'system' : 'personal' })
const activeTab = ref<'personal' | 'teaching' | 'system'>('personal')
const timeZoneOptions = preferences.timeZoneOptions
const filteredOptions = computed(() => { const query = search.value.trim().toLowerCase(); return query ? timeZoneOptions.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(query)) : timeZoneOptions })
const canTeaching = computed(() => overview.value?.tabs.teaching === true)
const canSystem = computed(() => overview.value?.tabs.system === true)
const selectedTeachingId = computed(() => typeof route.query.teaching_id === 'string' ? route.query.teaching_id : overview.value?.teachings[0]?.id)

function isTabAllowed(tab: 'personal' | 'teaching' | 'system') {
    return tab === 'personal' || (tab === 'teaching' && canTeaching.value) || (tab === 'system' && canSystem.value)
}

async function syncTab(tab: 'personal' | 'teaching' | 'system') {
    if (!overview.value || isTabAllowed(tab)) { activeTab.value = tab; return }
    activeTab.value = 'personal'
    await router.replace({ query: { ...route.query, tab: 'personal' } })
}

async function loadOverview() { loading.value = true; try { overview.value = (await apiV1Client.get<SettingsOverview>('/pages/settings/overview')).data } catch (error) { reportError(error) } finally { loading.value = false } }
async function selectTab(tab: 'personal' | 'teaching' | 'system') { if (dirty.value && !window.confirm('目前有尚未儲存的修改，確定要切換分頁嗎？')) return; if (tab === 'teaching' && !canTeaching.value) return router.replace({ query: { ...route.query, tab: 'personal' } }); if (tab === 'system' && !canSystem.value) return router.replace({ query: { ...route.query, tab: 'personal' } }); dirty.value = false; await router.replace({ query: { ...route.query, tab } }) }
function selectTimeZone(zone: string) { preferences.timeZone = zone; dirty.value = true }
function useBrowserTimeZone() { selectTimeZone(DateUtils.getBrowserTimeZone()) }
watch([requestedTab, canTeaching, canSystem], ([value]) => { void syncTab(value) })
watch(() => preferences.timeZone, () => { dirty.value = true })
onMounted(async () => { await loadOverview(); await syncTab(requestedTab.value) })
</script>

<template>
    <div class="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <BasePageHeader :overline="$t('nav.settings')" :title="$t('nav.settings')" subtitle="依權限管理個人、教學與系統設定"><template #icon><div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">⚙</div></template></BasePageHeader>
        <div v-if="loading" class="rounded-3xl border border-gray-100 bg-white p-10 text-center font-bold text-gray-400">載入設定中…</div>
        <template v-else>
            <nav class="flex flex-wrap gap-2 rounded-3xl border border-gray-100 bg-white p-3 shadow-sm" aria-label="設定分頁">
                <button class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'personal' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('personal')">個人設定</button>
                <button v-if="canTeaching" class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'teaching' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('teaching')">教學管理</button>
                <button v-if="canSystem" class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'system' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('system')">系統管理</button>
            </nav>
            <div v-if="activeTab === 'personal'" class="grid gap-6 lg:grid-cols-[18rem_1fr]">
                <aside class="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"><p class="mb-3 text-xs font-black uppercase tracking-widest text-gray-400">個人設定</p><a href="#timezone" class="block rounded-xl bg-emerald-50 px-4 py-3 font-bold text-emerald-700">時區與顯示</a><a href="#appearance" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">外觀與語言</a></aside>
                <div class="space-y-6">
                    <section id="timezone" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><div class="flex flex-wrap items-center justify-between gap-4"><div><h2 class="text-xl font-black">時區</h2><p class="mt-1 text-sm font-bold text-gray-400">用於課堂、報告與通知時間顯示</p></div><button class="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-black text-emerald-700" @click="useBrowserTimeZone">使用瀏覽器時區</button></div><div class="mt-5 rounded-2xl bg-emerald-50 p-5"><p class="text-xs font-black uppercase tracking-widest text-emerald-600">目前時區</p><p class="mt-1 text-xl font-black text-gray-900">{{ preferences.timeZoneLabel }}</p><p class="text-sm font-bold text-gray-500">{{ preferences.timeZone }}</p></div><div class="mt-5"><TimeZoneSelect :label="$t('common.time_zone')" dense /></div><input v-model="search" class="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3" :placeholder="$t('settings.timezone.search_placeholder')"><div class="mt-3 max-h-72 overflow-y-auto space-y-2"><button v-for="option in filteredOptions" :key="option.value" class="flex w-full justify-between rounded-xl px-4 py-3 text-left text-sm font-bold" :class="preferences.timeZone === option.value ? 'bg-emerald-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'" @click="selectTimeZone(option.value)"><span>{{ option.label }}</span><span>{{ option.value }}</span></button></div></section>
                    <section id="appearance" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><h2 class="text-xl font-black">外觀與語言</h2><div class="mt-5 flex items-center gap-4"><button class="h-12 w-12 rounded-xl bg-gray-50 text-xl font-black" @click="preferences.adjustGlobalScale(-preferences.STEP)">−</button><span class="font-black">{{ preferences.globalFontScale }}%</span><button class="h-12 w-12 rounded-xl bg-gray-50 text-xl font-black" @click="preferences.adjustGlobalScale(preferences.STEP)">＋</button></div><div class="mt-6 border-t border-gray-100 pt-5"><LanguageSwitcher full-width label-on-mobile align="left" /></div></section>
                </div>
            </div>
            <TeachingSettingsPanel v-else-if="activeTab === 'teaching'" :teachings="overview?.teachings ?? []" :teaching-id="selectedTeachingId" />
            <SystemSettingsPanel v-else-if="activeTab === 'system'" />
        </template>
    </div>
</template>
