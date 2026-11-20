<script setup lang="ts">
import { ref, useId } from 'vue'
import { copyToClipboard } from '@/utils/clipboard'
import { ui } from './styles'

/** Shows freshly issued recovery codes once, with copy, download and a "saved" confirmation. */
const props = defineProps<{ codes: string[] }>()
const saved = defineModel<boolean>('saved', { default: false })
const copied = ref(false)
const checkboxId = useId()

async function copyAll() {
    copied.value = await copyToClipboard(props.codes.join('\n'))
}
function download() {
    const url = URL.createObjectURL(new Blob([`EduLog recovery codes\n\n${props.codes.join('\n')}\n`], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'edulog-recovery-codes.txt'
    link.click()
    URL.revokeObjectURL(url)
}
</script>

<template>
    <div class="space-y-4">
        <p role="status" class="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{{ $t('auth.save_recovery_codes') }}</p>
        <ul class="grid grid-cols-2 gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-4 font-mono text-sm sm:grid-cols-2" :aria-label="$t('auth.factor_recovery_code')">
            <li v-for="code in codes" :key="code" class="rounded-lg bg-white px-3 py-2 text-center tracking-wider text-gray-900 shadow-sm"><code class="select-all">{{ code }}</code></li>
        </ul>
        <div class="flex flex-wrap gap-2">
            <button type="button" :class="ui.secondary" @click="copyAll">{{ $t(copied ? 'auth.copied' : 'auth.copy_codes') }}</button>
            <button type="button" :class="ui.secondary" @click="download">{{ $t('auth.download_codes') }}</button>
        </div>
        <div class="flex items-start gap-3 rounded-2xl border border-gray-100 p-4">
            <input :id="checkboxId" v-model="saved" type="checkbox" class="mt-0.5 h-5 w-5 cursor-pointer rounded accent-emerald-600">
            <label :for="checkboxId" class="cursor-pointer text-sm font-bold text-gray-800">{{ $t('auth.recovery_saved_confirm') }}</label>
        </div>
    </div>
</template>
