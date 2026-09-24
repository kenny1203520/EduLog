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
type PersonProfileForm = {
    display_name?: string | null
    contact_email?: string | null
    phone?: string | null
    address?: string | null
    mailing_address?: string | null
    birthday?: string | null
    government_id?: string | null
    bio?: string | null
    bio_document?: Record<string, unknown> | null
}
const loading = ref(true)
const overview = ref<SettingsOverview | null>(null)
const dirty = ref(false)
const profileLoading = ref(false)
const profileSaving = ref(false)
const personProfile = ref<PersonProfileForm>({})
const requestedTab = computed(() => { const value = typeof route.query.tab === 'string' ? route.query.tab : 'personal'; return ['personal', 'teaching', 'system'].includes(value) ? value as 'personal' | 'teaching' | 'system' : 'personal' })
const activeTab = ref<'personal' | 'teaching' | 'system'>('personal')
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
async function loadPersonProfile() { profileLoading.value = true; try { personProfile.value = (await apiV1Client.get<PersonProfileForm>('/pages/me/person-profile')).data ?? {} } catch (error) { reportError(error) } finally { profileLoading.value = false } }
async function savePersonProfile() { profileSaving.value = true; try { const fields = ['display_name', 'contact_email', 'phone', 'address', 'mailing_address', 'birthday', 'government_id', 'bio', 'bio_document'] as const; const values = personProfile.value as Record<string, unknown>; const patch = Object.fromEntries(fields.map((field) => [field, values[field] === '' ? null : values[field]])); personProfile.value = (await apiV1Client.patch<PersonProfileForm>('/pages/me/person-profile', patch)).data ?? personProfile.value } catch (error) { reportError(error) } finally { profileSaving.value = false } }
async function selectTab(tab: 'personal' | 'teaching' | 'system') { if (dirty.value && !window.confirm('目前有尚未儲存的修改，確定要切換分頁嗎？')) return; if (tab === 'teaching' && !canTeaching.value) return router.replace({ query: { ...route.query, tab: 'personal' } }); if (tab === 'system' && !canSystem.value) return router.replace({ query: { ...route.query, tab: 'personal' } }); dirty.value = false; await router.replace({ query: { ...route.query, tab } }) }
function useBrowserTimeZone() { preferences.timeZone = DateUtils.getBrowserTimeZone() }
watch([requestedTab, canTeaching, canSystem], ([value]) => { void syncTab(value) })
watch(() => preferences.timeZone, () => { dirty.value = true })
onMounted(async () => { await Promise.all([loadOverview(), loadPersonProfile()]); await syncTab(requestedTab.value) })
</script>

<template>
    <div class="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <BasePageHeader :overline="$t('nav.settings')" :title="$t('nav.settings')" :subtitle="$t('settings.page_subtitle')"><template #icon><div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600" aria-hidden="true"><svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 3h3l.6 2.1a7 7 0 0 1 1.6.9l2.1-.7 1.5 2.6-1.5 1.6a7 7 0 0 1 0 1.9l1.5 1.6-1.5 2.6-2.1-.7a7 7 0 0 1-1.6.9l-.6 2.1h-3l-.6-2.1a7 7 0 0 1-1.6-.9l-2.1.7-1.5-2.6 1.5-1.6a7 7 0 0 1 0-1.9L5.2 8l1.5-2.6 2.1.7a7 7 0 0 1 1.6-.9L10.5 3z"/><circle cx="12" cy="10.5" r="2.5" stroke-width="2"/></svg></div></template></BasePageHeader>
        <div v-if="loading" class="rounded-3xl border border-gray-100 bg-white p-10 text-center font-bold text-gray-400">{{ $t('common.loading') }}</div>
        <template v-else>
            <nav class="flex flex-wrap gap-2 rounded-3xl border border-gray-100 bg-white p-3 shadow-sm" :aria-label="$t('settings.tabs_aria')">
                <button class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'personal' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('personal')">{{ $t('settings.tab_personal') }}</button>
                <button v-if="canTeaching" class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'teaching' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('teaching')">{{ $t('settings.tab_teaching') }}</button>
                <button v-if="canSystem" class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'system' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('system')">{{ $t('settings.tab_system') }}</button>
            </nav>
            <div v-if="activeTab === 'personal'" class="grid gap-6 lg:grid-cols-[18rem_1fr]">
                <aside class="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"><p class="mb-3 text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('settings.personal_title') }}</p><a href="#profile" class="block rounded-xl bg-emerald-50 px-4 py-3 font-bold text-emerald-700">{{ $t('settings.profile.nav_label') }}</a><a href="#timezone" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('settings.timezone.nav_label') }}</a><a href="#appearance" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('settings.appearance.nav_label') }}</a></aside>
                <div class="space-y-6">
                    <section id="profile" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div class="flex flex-wrap items-start justify-between gap-4"><div><h2 class="text-xl font-black">{{ $t('settings.profile.title') }}</h2><p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.profile.description') }}</p></div><button class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50" :disabled="profileLoading || profileSaving" @click="savePersonProfile">{{ profileSaving ? $t('common.saving') : $t('common.save') }}</button></div>
                        <p v-if="profileLoading" class="mt-5 text-sm font-bold text-gray-400">{{ $t('common.loading') }}</p>
                        <div v-else class="mt-5 grid gap-4 sm:grid-cols-2">
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.display_name') }}<input v-model="personProfile.display_name" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" maxlength="200" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.contact_email') }}<input v-model="personProfile.contact_email" type="email" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.phone') }}<input v-model="personProfile.phone" type="tel" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.birthday') }}<input v-model="personProfile.birthday" type="date" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600 sm:col-span-2">{{ $t('settings.profile.address') }}<input v-model="personProfile.address" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600 sm:col-span-2">{{ $t('settings.profile.mailing_address') }}<input v-model="personProfile.mailing_address" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.government_id') }}<input v-model="personProfile.government_id" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600 sm:col-span-2">{{ $t('settings.profile.bio') }}<textarea v-model="personProfile.bio" rows="4" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" maxlength="10000" /></label>
                        </div>
                    </section>
                    <section id="timezone" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><div class="flex flex-wrap items-center justify-between gap-4"><div><h2 class="text-xl font-black">{{ $t('settings.timezone.title') }}</h2><p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.timezone.description') }}</p></div><button class="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-black text-emerald-700" @click="useBrowserTimeZone">{{ $t('settings.timezone.use_browser') }}</button></div><div class="mt-5 rounded-2xl bg-emerald-50 p-5"><p class="text-xs font-black uppercase tracking-widest text-emerald-600">{{ $t('settings.timezone.current') }}</p><p class="mt-1 text-xl font-black text-gray-900">{{ preferences.timeZoneLabel }}</p><p class="text-sm font-bold text-gray-500">{{ preferences.timeZone }}</p></div><div class="mt-5"><TimeZoneSelect :label="$t('common.time_zone')" dense /></div></section>
                    <section id="appearance" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><h2 class="text-xl font-black">{{ $t('settings.appearance.title') }}</h2><div class="mt-5 flex items-center gap-4"><button class="h-12 w-12 rounded-xl bg-gray-50 text-xl font-black" @click="preferences.adjustGlobalScale(-preferences.STEP)" :aria-label="$t('settings.appearance.decrease_font')">&minus;</button><span class="font-black">{{ preferences.globalFontScale }}%</span><button class="h-12 w-12 rounded-xl bg-gray-50 text-xl font-black" @click="preferences.adjustGlobalScale(preferences.STEP)" :aria-label="$t('settings.appearance.increase_font')">&plus;</button></div><div class="mt-6 border-t border-gray-100 pt-5"><LanguageSwitcher full-width label-on-mobile align="left" /></div></section>
                </div>
            </div>
            <TeachingSettingsPanel v-else-if="activeTab === 'teaching'" :teachings="overview?.teachings ?? []" :teaching-id="selectedTeachingId" />
            <SystemSettingsPanel v-else-if="activeTab === 'system'" />
        </template>
    </div>
</template>
