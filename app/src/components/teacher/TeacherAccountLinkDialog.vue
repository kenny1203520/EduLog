<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import { apiV1Client } from '@/services/api/ApiV1Client'

type Profile = { id: string; auth_user_id: string | null; profile_version: number; full_name: string | null; nickname: string | null; contact_email: string | null; phone: string | null; government_id: string | null; address: string | null; mailing_address: string | null; birthday: string | null; bio: string | null; bio_document: unknown }
type Account = { id: string; email: string; display_name: string | null }
type Field = keyof Pick<Profile, 'full_name' | 'nickname' | 'contact_email' | 'phone' | 'government_id' | 'address' | 'mailing_address' | 'birthday' | 'bio' | 'bio_document'>
const props = defineProps<{ teacherId: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const profile = ref<Profile | null>(null)
const targetProfile = ref<Profile | null>(null)
const query = ref('')
const accounts = ref<Account[]>([])
const selectedAccountId = ref<string | null>(null)
const ownership = ref<Record<Field, 'account' | 'teacher' | 'target' | null>>({
  full_name: null, nickname: null, contact_email: null, phone: null, government_id: null,
  address: null, mailing_address: null, birthday: null, bio: null, bio_document: null,
})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined

const fieldList: { key: Field; label: string }[] = [
  { key: 'full_name', label: 'full_name' }, { key: 'nickname', label: 'nickname' }, { key: 'contact_email', label: 'contact_email' },
  { key: 'phone', label: 'phone' }, { key: 'government_id', label: 'government_id' },
  { key: 'address', label: 'address' }, { key: 'mailing_address', label: 'mailing_address' },
  { key: 'birthday', label: 'birthday' }, { key: 'bio', label: 'bio' }, { key: 'bio_document', label: 'bio_document' },
]
const options = computed(() => accounts.value.map((account) => ({ value: account.id, label: `${account.display_name || account.email} · ${account.email}`, searchText: `${account.display_name ?? ''} ${account.email}` })))
const ownershipOptions = computed(() => selectedAccountId.value
  ? [
      ...(profile.value?.auth_user_id ? [{ value: 'account', label: t('teacher.account_link.keep_account') }] : []),
      { value: 'teacher', label: t('teacher.account_link.move_teacher') },
      { value: 'target', label: t('teacher.account_link.keep_target') },
    ]
  : [
      { value: 'account', label: t('teacher.account_link.keep_account') },
      { value: 'teacher', label: t('teacher.account_link.move_teacher') },
    ])

async function loadProfiles() {
  if (!selectedAccountId.value) targetProfile.value = null
  loading.value = true
  error.value = ''
  try {
    const queryString = selectedAccountId.value ? `?target_auth_user_id=${encodeURIComponent(selectedAccountId.value)}` : ''
    const response = await apiV1Client.get<{ current_profile: Profile; target_profile: Profile | null }>(`/teachers/${encodeURIComponent(props.teacherId)}/account-link${queryString}`)
    profile.value = response.data?.current_profile ?? null
    targetProfile.value = response.data?.target_profile ?? null
    fieldList.forEach(({ key }) => { ownership.value[key] = null })
  } catch { error.value = t('teacher.account_link.load_failed') } finally { loading.value = false }
}

function searchAccounts(value: string) {
  query.value = value
  if (searchTimer) clearTimeout(searchTimer)
  if (value.trim().length < 2) { accounts.value = []; return }
  searchTimer = setTimeout(async () => {
    try {
      const response = await apiV1Client.get<Account[]>(`/users/search?query=${encodeURIComponent(value.trim())}`)
      accounts.value = response.data ?? []
    } catch { accounts.value = []; error.value = t('teacher.account_link.search_failed') }
  }, 250)
}

watch(selectedAccountId, () => { void loadProfiles() })
onMounted(() => { void loadProfiles() })

async function save() {
  if (!profile.value) return
  if (fieldList.some(({ key }) => ownership.value[key] === null)) return
  saving.value = true
  error.value = ''
  try {
    await apiV1Client.patch(`/teachers/${encodeURIComponent(props.teacherId)}/account-link`, {
      target_auth_user_id: selectedAccountId.value,
      expected_profile_id: profile.value.id,
      expected_profile_version: profile.value.profile_version,
      expected_target_profile_id: targetProfile.value?.id ?? null,
      expected_target_version: targetProfile.value?.profile_version ?? null,
      field_ownership: ownership.value,
    })
    emit('saved')
    emit('close')
  } catch { error.value = t('teacher.account_link.save_failed') } finally { saving.value = false }
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return t('teacher.account_link.empty_value')
  if (typeof value === 'object') return t('teacher.account_link.has_rich_content')
  return String(value)
}
</script>

<template>
  <div class="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/50 p-4" @click.self="emit('close')">
    <section role="dialog" aria-modal="true" :aria-label="t('teacher.account_link.title')" class="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <header class="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white p-5">
        <div><h2 class="text-xl font-bold text-slate-900">{{ t('teacher.account_link.title') }}</h2><p class="mt-1 text-sm text-slate-600">{{ t('teacher.account_link.description') }}</p></div>
        <button type="button" class="rounded-lg px-3 py-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" @click="emit('close')">{{ t('common.close') }}</button>
      </header>
      <div class="space-y-5 p-5">
        <label class="block text-sm font-semibold text-slate-700">{{ t('teacher.account_link.target_account') }}
          <div class="mt-2 flex gap-2">
            <SearchableSelect v-model="selectedAccountId" class="min-w-0 flex-1" :options="options" remote-search :loading="loading" :placeholder="t('teacher.account_link.search_account')" :aria-label="t('teacher.account_link.target_account')" :no-results-text="query.length < 2 ? t('teacher.account_link.search_hint') : t('teacher.account_link.no_accounts')" @search="searchAccounts" />
            <button v-if="selectedAccountId" type="button" class="rounded-lg border border-slate-300 px-3 text-sm hover:bg-slate-50" @click="selectedAccountId = null">{{ t('teacher.account_link.unlink') }}</button>
          </div>
        </label>
        <p v-if="error" role="alert" class="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{{ error }}</p>
        <p class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{{ t('teacher.account_link.ownership_help') }}</p>
        <div v-if="loading" class="py-8 text-center text-slate-500">{{ t('common.loading') }}</div>
        <div v-else-if="profile" class="space-y-3">
          <article v-for="field in fieldList" :key="field.key" class="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[minmax(9rem,0.7fr)_1fr_1fr] md:items-center">
            <strong class="text-sm text-slate-800">{{ t(`teacher.account_link.fields.${field.label}`) }}</strong>
            <div class="text-xs text-slate-600"><span class="font-semibold">{{ t('teacher.account_link.current_profile_data') }}</span><div class="mt-1 break-words">{{ displayValue(profile[field.key]) }}</div></div>
            <div class="space-y-2"><div v-if="targetProfile" class="text-xs text-slate-600"><span class="font-semibold">{{ t('teacher.account_link.target_data') }}</span><div class="mt-1 break-words">{{ displayValue(targetProfile[field.key]) }}</div></div><SearchableSelect v-model="ownership[field.key]" :options="ownershipOptions" :aria-label="t(`teacher.account_link.fields.${field.label}`)" /></div>
          </article>
        </div>
      </div>
      <footer class="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white p-4">
        <button type="button" class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="button" class="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" :disabled="loading || saving || !profile || selectedAccountId === profile.auth_user_id || fieldList.some(({ key }) => ownership[key] === null)" @click="save">{{ saving ? t('common.saving') : t('common.save') }}</button>
      </footer>
    </section>
  </div>
</template>
