<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import ProviderIcon from './security/ProviderIcon.vue'
import MethodIcon from './security/MethodIcon.vue'
import { ui } from './security/styles'
import { authService } from '@/services/auth/AuthService'
import { providerLabel } from '@/utils/oauthProviders'

const props = defineProps<{ canManageProviders?: boolean }>()
const route = useRoute()
const data = ref<Awaited<ReturnType<typeof authService.identities>>>()
const selected = ref<{ id: string; provider: string }>()
const password = ref('')
const busy = ref(false)
const failed = ref(false)
const unlinkError = ref('')
const message = ref(route.query.identity === 'linked' ? 'identity_linked' : route.query.identity === 'error' ? 'identity_failed' : '')
const linkedProviders = computed(() => new Set(data.value?.identities.map(item => item.provider)))
const linkable = computed(() => data.value?.manual_linking ? data.value.providers.filter(provider => !linkedProviders.value.has(provider)) : [])
const providerSettings = { path: '/dashboard/settings', query: { tab: 'system', section: 'login_providers' } }

async function load() {
    busy.value = true
    failed.value = false
    try { data.value = await authService.identities() }
    catch { failed.value = true }
    finally { busy.value = false }
}
async function link(provider: string) {
    busy.value = true
    message.value = ''
    try { window.location.assign(await authService.linkIdentity(provider)) }
    catch { message.value = 'identity_failed'; busy.value = false }
}
function closeUnlink() {
    selected.value = undefined
    password.value = ''
    unlinkError.value = ''
}
async function unlink() {
    if (!selected.value) return
    busy.value = true
    unlinkError.value = ''
    try {
        await authService.unlinkIdentity(selected.value.id, password.value)
        closeUnlink()
        message.value = 'identity_removed'
        await load()
    } catch (error) {
        const code = (error as { code?: string }).code
        unlinkError.value = code === 'CURRENT_PASSWORD_INVALID' ? 'identity_password_invalid' : code === 'OAUTH_BACKUP_LOGIN_REQUIRED' ? 'identity_backup_required' : 'identity_failed'
        password.value = ''
    } finally { busy.value = false }
}
onMounted(load)
</script>

<template>
    <section class="space-y-4" aria-labelledby="linked-identities-title" :aria-busy="busy">
        <div>
            <h3 id="linked-identities-title" class="text-lg font-black">{{ $t('auth.identities_title') }}</h3>
            <p class="mt-1 text-sm text-gray-600">{{ $t('auth.identities_description') }}</p>
        </div>
        <p v-if="message" role="status" :class="message === 'identity_failed' ? ui.alert : ui.notice">{{ $t('auth.' + message) }}</p>
        <div v-if="failed" role="alert" :class="ui.alert">
            <p class="flex-1">{{ $t('auth.providers_unavailable') }}</p>
            <button type="button" :disabled="busy" :class="ui.ghost" @click="load">{{ $t('auth.retry_providers') }}</button>
        </div>

        <div v-if="!data && !failed" class="grid gap-3 sm:grid-cols-2" aria-hidden="true">
            <div v-for="index in 2" :key="index" class="h-20 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none" />
        </div>

        <template v-if="data && !failed">
            <ul v-if="data.identities.length || linkable.length" class="grid gap-3 sm:grid-cols-2">
                <li v-for="item in data.identities" :key="item.id" class="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4">
                    <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white"><ProviderIcon :provider="item.provider" /></span>
                    <div class="min-w-0 flex-1">
                        <p class="truncate font-black" translate="no">{{ providerLabel(item.provider) }}</p>
                        <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-800">{{ $t('auth.linked_badge') }}</span>
                    </div>
                    <button v-if="data.manual_linking" type="button" :disabled="busy" :class="ui.danger" @click="selected = { id: item.id, provider: item.provider }">{{ $t('auth.unlink') }}</button>
                </li>
                <li v-for="provider in linkable" :key="provider">
                    <button type="button" :disabled="busy"
                        class="group flex min-h-[4.5rem] w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-gray-300 bg-gray-50/60 p-4 text-left transition-colors duration-200 hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                        @click="link(provider)">
                        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-white"><ProviderIcon :provider="provider" /></span>
                        <span class="min-w-0 flex-1 font-black text-gray-800 group-hover:text-emerald-800">{{ $t('auth.link_provider', { provider: providerLabel(provider) }) }}</span>
                        <svg class="h-5 w-5 text-gray-400 group-hover:text-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" d="M12 5v14M5 12h14" /></svg>
                    </button>
                </li>
            </ul>

            <div v-if="!data.manual_linking || !data.providers.length" class="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-gray-200 p-5 sm:flex-row sm:items-center">
                <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500"><MethodIcon name="link" /></span>
                <div class="min-w-0 flex-1 text-sm">
                    <p class="font-bold text-gray-800">{{ $t(!data.manual_linking ? 'auth.identity_linking_disabled' : 'auth.identity_providers_empty') }}</p>
                    <p v-if="!data.identities.length" class="mt-0.5 text-gray-600">{{ $t('auth.identities_empty') }}</p>
                </div>
                <RouterLink v-if="props.canManageProviders" :to="providerSettings" :class="ui.secondary">{{ $t('auth.configure_providers') }}</RouterLink>
            </div>
        </template>

        <AppDialog v-if="selected" open :title="$t('auth.unlink_provider', { provider: providerLabel(selected.provider) })" :description="$t('auth.unlink_description')" @close="closeUnlink">
            <form class="space-y-4" @submit.prevent="unlink">
                <div>
                    <label for="identity-current-password" :class="ui.label">{{ $t('auth.identity_confirm_password') }}</label>
                    <PasswordInput id="identity-current-password" v-model="password" purpose="current" required :maxlength="1024" :input-class="ui.input" />
                </div>
                <p v-if="unlinkError" role="alert" :class="ui.alert">{{ $t('auth.' + unlinkError) }}</p>
                <div class="flex flex-wrap justify-end gap-2">
                    <button type="button" :disabled="busy" :class="ui.ghost" @click="closeUnlink">{{ $t('common.cancel') }}</button>
                    <button type="submit" :disabled="busy" :class="ui.dangerSolid">{{ $t('auth.unlink') }}</button>
                </div>
            </form>
        </AppDialog>
    </section>
</template>
