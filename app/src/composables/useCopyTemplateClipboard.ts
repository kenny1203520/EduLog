import { ref, shallowRef, watch } from 'vue'
import { renderTemplateContent } from '@/components/text-editor/content'
import type { EffectiveTemplateResult } from '@/services/copy-template/CopyTemplateQueryService'
import { copyRichTextToClipboard } from '@/utils/clipboard'
import { formatCopyTemplateToken, renderCopyTemplate } from '@/utils/copyTemplate'

export function useCopyTemplateClipboard(
    contextKey: () => string | undefined,
    loadTemplate: () => Promise<EffectiveTemplateResult>,
    systemTemplate: string
) {
    const template = shallowRef<EffectiveTemplateResult>()
    const loading = ref(false)
    const loadFailed = ref(false)
    const manualText = ref('')
    let generation = 0
    let copyRequest = 0

    async function reload() {
        const request = ++generation
        template.value = undefined
        loadFailed.value = false
        loading.value = Boolean(contextKey())
        if (!loading.value) return

        try {
            const result = await loadTemplate()
            if (request === generation) template.value = result
        } catch {
            if (request === generation) loadFailed.value = true
        } finally {
            if (request === generation) loading.value = false
        }
    }

    function resetCopy() {
        copyRequest++
        manualText.value = ''
    }

    watch(contextKey, () => {
        resetCopy()
        void reload()
    }, { immediate: true, flush: 'sync' })

    async function copy(
        values: Parameters<typeof renderCopyTemplate>[1],
        formatters: Parameters<typeof renderCopyTemplate>[2]
    ) {
        return copyAll([{ values, formatters }])
    }

    async function copyAll(contexts: Array<{
        values: Parameters<typeof renderCopyTemplate>[1]
        formatters: Parameters<typeof renderCopyTemplate>[2]
    }>) {
        if (!contexts.length) return false
        const request = ++copyRequest
        manualText.value = ''
        const current = template.value
        const blocks = contexts.map(({ values, formatters }) => {
            const render = (text: string) => renderCopyTemplate(text, values, formatters)
            const resolve = (key: string, mode?: string | null) => render(formatCopyTemplateToken(key, mode ?? undefined))
            const rendered = renderTemplateContent(current?.templateDocument || current?.templateText || systemTemplate, resolve, render)
            return rendered.plainText.trim() ? rendered : renderTemplateContent(systemTemplate, resolve, render)
        })
        const first = blocks[0]!
        const content = blocks.length === 1 ? first : {
            plainText: blocks.map(block => block.plainText).join('\n\n'),
            richText: {
                ...first.richText,
                doc: {
                    ...first.richText.doc,
                    content: blocks.flatMap((block, index) => [
                        ...(index ? [{ type: 'paragraph' }] : []),
                        ...(block.richText.doc.content ?? []),
                    ]),
                },
            },
        }
        const result = await copyRichTextToClipboard(content).catch(() => false)
        if (request !== copyRequest) return false
        if (!result) manualText.value = content.plainText
        return result
    }

    return { loading, loadFailed, manualText, reload, resetCopy, copy, copyAll }
}
