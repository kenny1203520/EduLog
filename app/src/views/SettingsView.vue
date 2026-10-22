<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import TimeZoneSelect from '@/components/common/TimeZoneSelect.vue'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { apiV1Client } from '@/services/api/ApiV1Client'
import type { SettingsOverview } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'
import PasswordInput from '@/components/common/PasswordInput.vue'
import WebExtensionIntegrations from '@/components/settings/WebExtensionIntegrations.vue'
import MyAiCredentials from '@/components/settings/ai/MyAiCredentials.vue'

const SystemSettingsPanel = defineAsyncComponent(() => import('@/components/settings/SystemSettingsPanel.vue'))
const route = useRoute()
const router = useRouter()
const preferences = usePreferencesStore()
const auth = useAuthStore()
const { reportError, success } = useFeedback()
type PersonProfileForm = {
    full_name?: string | null
    nickname?: string | null
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
const securityBusy = ref<'email' | 'password' | null>(null)
const securityError = ref('')
const securityNotice = ref('')
const emailChange = ref({ current_password: '', email: '' })
const passwordChange = ref({ current_password: '', new_password: '', confirm_password: '' })
const currentEmail = computed(() => auth.user?.email ?? '')
const requestedTab = computed(() => { const value = typeof route.query.tab === 'string' ? route.query.tab : 'personal'; return ['personal', 'system'].includes(value) ? value as 'personal' | 'system' : 'personal' })
const activeTab = ref<'personal' | 'system'>('personal')
const canSystem = computed(() => overview.value?.tabs.system === true)

function isTabAllowed(tab: 'personal' | 'system') {
    return tab === 'personal' || (tab === 'system' && canSystem.value)
}

async function syncTab(tab: 'personal' | 'system') {
    if (!overview.value || isTabAllowed(tab)) { activeTab.value = tab; return }
    activeTab.value = 'personal'
    await router.replace({ query: { ...route.query, tab: 'personal' } })
}

async function loadOverview() { loading.value = true; try { overview.value = (await apiV1Client.get<SettingsOverview>('/pages/settings/overview')).data } catch (error) { reportError(error) } finally { loading.value = false } }
async function loadPersonProfile() { profileLoading.value = true; try { personProfile.value = (await apiV1Client.get<PersonProfileForm>('/pages/me/person-profile')).data ?? {} } catch (error) { reportError(error) } finally { profileLoading.value = false } }
async function savePersonProfile() { profileSaving.value = true; try { const fields = ['full_name', 'nickname', 'contact_email', 'phone', 'address', 'mailing_address', 'birthday', 'government_id', 'bio', 'bio_document'] as const; const values = personProfile.value as Record<string, unknown>; const patch = Object.fromEntries(fields.map((field) => [field, values[field] === '' ? null : values[field]])); personProfile.value = (await apiV1Client.patch<PersonProfileForm>('/pages/me/person-profile', patch)).data ?? personProfile.value; if (auth.user) auth.user = { ...auth.user, full_name: personProfile.value.full_name ?? null, nickname: personProfile.value.nickname ?? null, display_name: personProfile.value.nickname?.trim() || personProfile.value.full_name || null }; success('common.save_success') } catch (error) { reportError(error) } finally { profileSaving.value = false } }
function securityErrorKey(error: unknown) { const code = (error as { code?: string })?.code; return code === 'CURRENT_PASSWORD_INVALID' ? 'settings.security.current_password_invalid' : code === 'RATE_LIMITED' ? 'settings.security.rate_limited' : 'settings.security.request_failed' }
async function requestEmailChange() { securityBusy.value = 'email'; securityError.value = ''; securityNotice.value = ''; try { await apiV1Client.post('/auth/me/email', emailChange.value); emailChange.value = { current_password: '', email: '' }; securityNotice.value = 'settings.security.email_confirmation_sent'; success(securityNotice.value) } catch (error) { securityError.value = securityErrorKey(error) } finally { securityBusy.value = null } }
async function changePassword() { securityError.value = ''; securityNotice.value = ''; if (passwordChange.value.new_password !== passwordChange.value.confirm_password) { securityError.value = 'settings.security.password_mismatch'; return } securityBusy.value = 'password'; try { await apiV1Client.post('/auth/me/password', passwordChange.value); passwordChange.value = { current_password: '', new_password: '', confirm_password: '' }; securityNotice.value = 'settings.security.password_changed'; success(securityNotice.value) } catch (error) { securityError.value = securityErrorKey(error) } finally { securityBusy.value = null } }
async function selectTab(tab: 'personal' | 'system') { if (dirty.value && !window.confirm('目前有尚未儲存的修改，確定要切換分頁嗎？')) return; if (tab === 'system' && !canSystem.value) return router.replace({ query: { ...route.query, tab: 'personal' } }); dirty.value = false; await router.replace({ query: { ...route.query, tab } }) }
function useBrowserTimeZone() { preferences.timeZone = DateUtils.getBrowserTimeZone() }
watch([requestedTab, canSystem], ([value]) => { void syncTab(value) })
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
                <button v-if="canSystem" class="rounded-2xl px-5 py-3 text-sm font-black transition" :class="activeTab === 'system' ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-50'" @click="selectTab('system')">{{ $t('settings.tab_system') }}</button>
            </nav>
            <div v-if="activeTab === 'personal'" class="grid gap-6 lg:grid-cols-[18rem_1fr]">
                <aside class="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm"><p class="mb-3 text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('settings.personal_title') }}</p><a href="#profile" class="block rounded-xl bg-emerald-50 px-4 py-3 font-bold text-emerald-700">{{ $t('settings.profile.nav_label') }}</a><a href="#security" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('settings.security.nav_label') }}</a><a href="#timezone" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('settings.timezone.nav_label') }}</a><a href="#appearance" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('settings.appearance.nav_label') }}</a><a href="#integrations" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('settings.extension.title') }}</a><a href="#ai-credentials" class="mt-2 block rounded-xl px-4 py-3 font-bold text-gray-500 hover:bg-gray-50">{{ $t('ai.settings.personal_title') }}</a></aside>
                <div class="space-y-6">
                    <section id="profile" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div class="flex flex-wrap items-start justify-between gap-4"><div><h2 class="text-xl font-black">{{ $t('settings.profile.title') }}</h2><p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.profile.description') }}</p></div><button class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50" :disabled="profileLoading || profileSaving" @click="savePersonProfile">{{ profileSaving ? $t('common.saving') : $t('common.save') }}</button></div>
                        <p v-if="profileLoading" class="mt-5 text-sm font-bold text-gray-400">{{ $t('common.loading') }}</p>
                        <div v-else class="mt-5 grid gap-4 sm:grid-cols-2">
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.full_name') }}<input v-model="personProfile.full_name" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" maxlength="200" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.nickname') }}<input v-model="personProfile.nickname" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" maxlength="100" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.contact_email') }}<input v-model="personProfile.contact_email" type="email" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.phone') }}<input v-model="personProfile.phone" type="tel" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.birthday') }}<input v-model="personProfile.birthday" type="date" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600 sm:col-span-2">{{ $t('settings.profile.address') }}<input v-model="personProfile.address" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600 sm:col-span-2">{{ $t('settings.profile.mailing_address') }}<input v-model="personProfile.mailing_address" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600">{{ $t('settings.profile.government_id') }}<input v-model="personProfile.government_id" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                            <label class="text-sm font-bold text-gray-600 sm:col-span-2">{{ $t('settings.profile.bio') }}<textarea v-model="personProfile.bio" rows="4" class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" maxlength="10000" /></label>
                        </div>
                    </section>
                    <section id="security" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div><h2 class="text-xl font-black">{{ $t('settings.security.title') }}</h2><p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.security.description') }}</p></div>
                        <p v-if="securityError" role="alert" class="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{{ $t(securityError) }}</p>
                        <p v-if="securityNotice" role="status" class="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{{ $t(securityNotice) }}</p>
                        <div class="mt-5 grid gap-6 lg:grid-cols-2">
                            <form class="space-y-4 rounded-2xl border border-gray-100 p-5" @submit.prevent="requestEmailChange">
                                <div><h3 class="font-black">{{ $t('settings.security.change_email') }}</h3><p class="mt-1 text-sm text-gray-500">{{ $t('settings.security.current_email') }}: {{ currentEmail || '—' }}</p></div>
                                <div><label for="email-change-current-password" class="block text-sm font-bold text-gray-600">{{ $t('settings.security.current_password') }}</label><PasswordInput id="email-change-current-password" v-model="emailChange.current_password" autocomplete="current-password" required :maxlength="1024" input-class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></div>
                                <label for="email-change-new-email" class="block text-sm font-bold text-gray-600">{{ $t('settings.security.new_email') }}<input id="email-change-new-email" v-model="emailChange.email" type="email" autocomplete="email" required maxlength="320" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></label>
                                <p class="text-xs text-gray-500">{{ $t('settings.security.email_confirmation_hint') }}</p>
                                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50" :disabled="securityBusy !== null">{{ securityBusy === 'email' ? $t('common.saving') : $t('settings.security.submit_email') }}</button>
                            </form>
                            <form class="space-y-4 rounded-2xl border border-gray-100 p-5" @submit.prevent="changePassword">
                                <div><h3 class="font-black">{{ $t('settings.security.change_password') }}</h3><p class="mt-1 text-sm text-gray-500">{{ $t('settings.security.password_hint') }}</p></div>
                                <div><label for="password-change-current-password" class="block text-sm font-bold text-gray-600">{{ $t('settings.security.current_password') }}</label><PasswordInput id="password-change-current-password" v-model="passwordChange.current_password" autocomplete="current-password" required :maxlength="1024" input-class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></div>
                                <div><label for="password-change-new-password" class="block text-sm font-bold text-gray-600">{{ $t('settings.security.new_password') }}</label><PasswordInput id="password-change-new-password" v-model="passwordChange.new_password" autocomplete="new-password" required :minlength="8" :maxlength="1024" input-class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></div>
                                <div><label for="password-change-confirm-password" class="block text-sm font-bold text-gray-600">{{ $t('settings.security.confirm_password') }}</label><PasswordInput id="password-change-confirm-password" v-model="passwordChange.confirm_password" autocomplete="new-password" required :minlength="8" :maxlength="1024" input-class="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-gray-900" /></div>
                                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-50" :disabled="securityBusy !== null">{{ securityBusy === 'password' ? $t('common.saving') : $t('settings.security.submit_password') }}</button>
                            </form>
                        </div>
                    </section>
                    <section id="timezone" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><div class="flex flex-wrap items-center justify-between gap-4"><div><h2 class="text-xl font-black">{{ $t('settings.timezone.title') }}</h2><p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.timezone.description') }}</p></div><button class="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-black text-emerald-700" @click="useBrowserTimeZone">{{ $t('settings.timezone.use_browser') }}</button></div><div class="mt-5 rounded-2xl bg-emerald-50 p-5"><p class="text-xs font-black uppercase tracking-widest text-emerald-600">{{ $t('settings.timezone.current') }}</p><p class="mt-1 text-xl font-black text-gray-900">{{ preferences.timeZoneLabel }}</p><p class="text-sm font-bold text-gray-500">{{ preferences.timeZone }}</p></div><div class="mt-5"><TimeZoneSelect :label="$t('common.time_zone')" dense /></div></section>
                    <section id="appearance" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><h2 class="text-xl font-black">{{ $t('settings.appearance.title') }}</h2><div class="mt-5 flex items-center gap-4"><button class="h-12 w-12 rounded-xl bg-gray-50 text-xl font-black" @click="preferences.adjustGlobalScale(-preferences.STEP)" :aria-label="$t('settings.appearance.decrease_font')">&minus;</button><span class="font-black">{{ preferences.globalFontScale }}%</span><button class="h-12 w-12 rounded-xl bg-gray-50 text-xl font-black" @click="preferences.adjustGlobalScale(preferences.STEP)" :aria-label="$t('settings.appearance.increase_font')">&plus;</button></div><div class="mt-6 border-t border-gray-100 pt-5"><LanguageSwitcher full-width label-on-mobile align="left" /></div></section>
                    <section id="integrations" class="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div class="mb-5"><h2 class="text-xl font-black text-slate-900">{{ $t('settings.extension.title') }}</h2></div><WebExtensionIntegrations /></section>
                    <section id="ai-credentials" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm"><h2 class="mb-4 text-xl font-black">{{ $t('ai.settings.personal_title') }}</h2><MyAiCredentials /></section>
                </div>
            </div>
            <SystemSettingsPanel v-else-if="activeTab === 'system'" />
        </template>
    </div>
</template>
