import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { extensionPanelOrigin } from '@/composables/useExtensionPanel'

// The EduLog extension opens this page in the browser side panel next to a teaching-site report
// form, with ?source_fill=<channel>. The panel page (the parent frame) answers a ping; 回填 then
// sends the saved report id to it. Only the channel and report id are sent; the extension reads
// the report itself and the teacher reviews every field on the teaching site before it is applied.
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
  const panelOrigin = extensionPanelOrigin()
  let timer: ReturnType<typeof setTimeout> | null = null

  const finish = (next: SourceFillState, why: string | null = null) => {
    if (timer) clearTimeout(timer)
    timer = null
    state.value = next
    reason.value = why
  }
  const post = (message: Record<string, unknown>) => { if (panelOrigin) window.parent.postMessage(message, panelOrigin) }
  const onMessage = (event: MessageEvent) => {
    if (!panelOrigin || event.source !== window.parent || event.origin !== panelOrigin) return
    const data = event.data as { type?: string; channel?: string; ok?: boolean; reason?: string | null } | null
    if (data?.type === 'edulog:bridge-ready') bridgeReady.value = true
    if (data?.type === 'edulog:source-fill-result' && data.channel === channel.value && state.value === 'sending') {
      finish(data.ok ? 'sent' : 'failed', data.ok ? null : String(data.reason || 'UNKNOWN'))
    }
  }

  onMounted(() => {
    window.addEventListener('message', onMessage)
    if (channel.value) post({ type: 'edulog:bridge-ping' })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('message', onMessage)
    if (timer) clearTimeout(timer)
  })

  function send(reportId: string) {
    if (!channel.value || !bridgeReady.value || state.value === 'sending') return
    state.value = 'sending'
    reason.value = null
    post({ type: 'edulog:source-fill', channel: channel.value, reportId })
    timer = setTimeout(() => finish('failed', 'TIMEOUT'), RESULT_TIMEOUT_MS)
  }

  return { bridgeReady, state, reason, send, reset: () => finish('idle') }
}
