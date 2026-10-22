import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

// The EduLog extension can open this page beside a teaching-site report form with
// ?source_fill=<channel>. Its bridge script (present only on this origin, only when the
// extension is paired) announces itself; 回填 then sends the saved report id back through it.
// Only the channel and report id are sent; the extension reads the report itself and the
// teacher reviews every field on the teaching site before it is applied.
export type SourceFillState = 'idle' | 'sending' | 'sent' | 'failed'

const CHANNEL = /^[a-f0-9]{32}$/
const RESULT_TIMEOUT_MS = 15000

export function sourceFillChannel(value: unknown): string | null {
  const text = Array.isArray(value) ? value[0] : value
  return typeof text === 'string' && CHANNEL.test(text) ? text : null
}

export function useSourceFill(channel: Ref<string | null>) {
  const bridgeReady = ref(false)
  const state = ref<SourceFillState>('idle')
  const reason = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  const finish = (next: SourceFillState, why: string | null = null) => {
    if (timer) clearTimeout(timer)
    timer = null
    state.value = next
    reason.value = why
  }
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return
    const data = event.data as { type?: string; channel?: string; ok?: boolean; reason?: string | null } | null
    if (data?.type === 'edulog:bridge-ready') bridgeReady.value = true
    if (data?.type === 'edulog:source-fill-result' && data.channel === channel.value && state.value === 'sending') {
      finish(data.ok ? 'sent' : 'failed', data.ok ? null : String(data.reason || 'UNKNOWN'))
    }
  }

  onMounted(() => {
    window.addEventListener('message', onMessage)
    bridgeReady.value = document.documentElement.dataset.edulogBridge === 'ready'
    if (channel.value && !bridgeReady.value) window.postMessage({ type: 'edulog:bridge-ping' }, window.location.origin)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    if (timer) clearTimeout(timer)
  })

  function send(reportId: string) {
    if (!channel.value || !bridgeReady.value || state.value === 'sending') return
    state.value = 'sending'
    reason.value = null
    window.postMessage({ type: 'edulog:source-fill', channel: channel.value, reportId }, window.location.origin)
    timer = setTimeout(() => finish('failed', 'TIMEOUT'), RESULT_TIMEOUT_MS)
  }

  return { bridgeReady, state, reason, send, reset: () => finish('idle') }
}
