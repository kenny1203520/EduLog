<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import PasswordInput from '@/components/ui/PasswordInput.vue'
import { authService } from '@/services/auth/AuthService'
import { providerLabel } from '@/utils/oauthProviders'

const route = useRoute()
const data = ref<Awaited<ReturnType<typeof authService.identities>>>()
const selected = ref<string>()
const password = ref('')
const busy = ref(false)
const failed = ref(false)
const message = ref(route.query.identity === 'linked' ? 'identity_linked' : route.query.identity === 'error' ? 'identity_failed' : '')

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
function cancel() { selected.value = undefined; password.value = '' }
async function unlink() {
    if (!selected.value) return
    busy.value = true
    message.value = ''
    try {
        await authService.unlinkIdentity(selected.value, password.value)
        cancel()
        message.value = 'identity_removed'
        await load()
    } catch (error) {
        const code = (error as { code?: string }).code
        message.value = code === 'CURRENT_PASSWORD_INVALID' ? 'identity_password_invalid' : code === 'OAUTH_BACKUP_LOGIN_REQUIRED' ? 'identity_backup_required' : 'identity_failed'
        password.value = ''
    } finally { busy.value = false }
}
onMounted(load)
</script>

<template>
    <section class="mt-6 space-y-3 border-t border-slate-200 pt-5" aria-labelledby="linked-identities-title">
        <h3 id="linked-identities-title" class="font-black">{{ $t('auth.identities_title') }}</h3>
        <p role="status" class="text-sm text-slate-700">{{ message ? $t('auth.' + message) : failed ? $t('auth.providers_unavailable') : '' }}</p>
        <button v-if="failed" type="button" class="rounded-lg border px-3 py-2 focus-visible:ring-2" @click="load">{{ $t('auth.retry_providers') }}</button>
        <template v-if="data && !failed">
            <p v-if="!data.identities.length" class="text-sm text-slate-700">{{ $t('auth.identities_empty') }}</p>
            <ul v-else class="space-y-2">
                <li v-for="item in data.identities" :key="item.id" class="flex flex-wrap items-center gap-3">
                    <span translate="no">{{ providerLabel(item.provider) }}</span>
                    <button v-if="data.manual_linking" type="button" :disabled="busy" class="rounded-lg border px-3 py-2 focus-visible:ring-2" @click="cancel(); selected = item.id">{{ $t('auth.unlink_provider', { provider: providerLabel(item.provider) }) }}</button>
                    <form v-if="selected === item.id" class="flex w-full flex-wrap items-end gap-2" @submit.prevent="unlink">
                        <label for="identity-current-password" class="text-sm">{{ $t('auth.identity_confirm_password') }}
                            <PasswordInput id="identity-current-password" v-model="password" name="current-password" autocomplete="current-password" required :maxlength="1024" input-class="block rounded-lg border px-3 py-2" />
                        </label>
                        <button type="submit" :disabled="busy" class="rounded-lg bg-red-700 px-3 py-2 text-white focus-visible:ring-2">{{ $t('auth.unlink_provider', { provider: providerLabel(item.provider) }) }}</button>
                        <button type="button" :disabled="busy" class="rounded-lg border px-3 py-2 focus-visible:ring-2" @click="cancel">{{ $t('common.cancel') }}</button>
                    </form>
                </li>
            </ul>
            <div v-if="data.manual_linking" class="flex flex-wrap gap-2">
                <button v-for="provider in data.providers" :key="provider" type="button" :disabled="busy" class="rounded-lg border px-3 py-2 font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:ring-2" @click="link(provider)">
                    {{ $t('auth.link_provider', { provider: providerLabel(provider) }) }}
                </button>
            </div>
        </template>
    </section>
</template>
