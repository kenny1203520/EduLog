<template>
    <section class="collaborative-editor">
        <div class="collaborative-editor__header">
            <div class="collaborative-editor__users" aria-label="Online users">
                <span
                    v-for="onlineUser in onlineUsers"
                    :key="onlineUser.clientId"
                    class="collaborative-editor__user"
                    :title="onlineUser.name"
                >
                    <span
                        class="collaborative-editor__user-dot"
                        :style="{ backgroundColor: onlineUser.color }"
                    />
                    <span class="collaborative-editor__user-name">{{ onlineUser.name }}</span>
                </span>
                <span v-if="onlineUsers.length === 0" class="collaborative-editor__empty-users">
                    No users online
                </span>
            </div>
            <span class="collaborative-editor__status" :data-status="status">
                {{ statusLabel }}
            </span>
        </div>

        <div
            class="collaborative-editor__body"
            :class="{ 'collaborative-editor__body--disabled': !editable }"
            :style="{ '--editor-min-height': `${minHeight}px` }"
        >
            <EditorContent v-if="editor" :editor="editor" class="collaborative-editor__content" />
            <div v-if="showPlaceholder" class="collaborative-editor__placeholder">
                {{ placeholder }}
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import * as Y from 'yjs'
import { supabase } from '@/lib/supabase'
import {
    SupabaseProvider,
    type CollaborativeUser,
    type OnlineUser,
    type ProviderStatus
} from '@/services/collab/SupabaseProvider'

interface Props {
    roomId: string
    user: CollaborativeUser
    placeholder?: string
    editable?: boolean
    field?: string
    minHeight?: number
    debounceMs?: number
}

const props = withDefaults(defineProps<Props>(), {
    placeholder: '',
    editable: true,
    field: 'default',
    minHeight: 280,
    debounceMs: 2500
})

const editor = shallowRef<Editor | null>(null)
const ydoc = shallowRef<Y.Doc | null>(null)
const provider = shallowRef<SupabaseProvider | null>(null)
const onlineUsers = ref<OnlineUser[]>([])
const status = ref<ProviderStatus>('idle')

let unwatchUsers: (() => void) | null = null
let unwatchStatus: (() => void) | null = null

const statusLabel = computed(() => {
    switch (status.value) {
        case 'connected':
            return 'Connected'
        case 'connecting':
            return 'Connecting'
        case 'error':
            return 'Connection error'
        case 'disconnected':
            return 'Disconnected'
        case 'idle':
        default:
            return 'Idle'
    }
})

const showPlaceholder = computed(() => {
    return Boolean(props.placeholder && editor.value?.isEmpty)
})

const cleanup = (): void => {
    unwatchUsers?.()
    unwatchStatus?.()
    unwatchUsers = null
    unwatchStatus = null

    editor.value?.destroy()
    editor.value = null

    if (provider.value) {
        void provider.value.destroy()
        provider.value = null
    }

    ydoc.value?.destroy()
    ydoc.value = null

    onlineUsers.value = []
    status.value = 'idle'
}

const initialize = (): void => {
    cleanup()

    if (!props.roomId) return

    const doc = new Y.Doc()
    const collabProvider = new SupabaseProvider({
        supabase,
        doc,
        roomId: props.roomId,
        user: props.user,
        debounceMs: props.debounceMs
    })

    ydoc.value = doc
    provider.value = collabProvider

    unwatchUsers = collabProvider.onUsersChange((users) => {
        onlineUsers.value = users
    })
    unwatchStatus = collabProvider.onStatusChange((nextStatus) => {
        status.value = nextStatus
    })

    editor.value = new Editor({
        extensions: [
            StarterKit.configure({
                history: false,
                undoRedo: false
            } as Record<string, unknown>),
            Collaboration.configure({
                document: doc,
                field: props.field
            }),
            CollaborationCaret.configure({
                provider: collabProvider,
                user: props.user
            })
        ],
        editable: props.editable,
        editorProps: {
            attributes: {
                class: 'collaborative-editor__tiptap'
            }
        }
    })

    collabProvider.connect()
}

watch(
    () => props.editable,
    (editable) => {
        editor.value?.setEditable(editable)
    }
)

watch(
    () => props.user,
    (user) => {
        provider.value?.updateUser(user)
        editor.value?.commands.updateUser(user)
    },
    { deep: true }
)

watch(
    () => [props.roomId, props.field] as const,
    () => {
        initialize()
    }
)

onMounted(() => {
    initialize()
})

onUnmounted(() => {
    cleanup()
})

defineExpose({
    editor,
    provider,
    ydoc
})
</script>

<style scoped>
.collaborative-editor {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
}

.collaborative-editor__header {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
    min-height: 2rem;
}

.collaborative-editor__users {
    align-items: center;
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    gap: 0.4rem;
    min-width: 0;
}

.collaborative-editor__user {
    align-items: center;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    color: #334155;
    display: inline-flex;
    font-size: 0.8125rem;
    font-weight: 600;
    gap: 0.35rem;
    max-width: 12rem;
    min-height: 1.75rem;
    padding: 0 0.6rem 0 0.45rem;
}

.collaborative-editor__user-dot {
    border-radius: 999px;
    flex: 0 0 auto;
    height: 0.6rem;
    width: 0.6rem;
}

.collaborative-editor__user-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.collaborative-editor__empty-users,
.collaborative-editor__status {
    color: #64748b;
    font-size: 0.8125rem;
}

.collaborative-editor__status {
    flex: 0 0 auto;
}

.collaborative-editor__status[data-status='connected'] {
    color: #047857;
}

.collaborative-editor__status[data-status='error'] {
    color: #dc2626;
}

.collaborative-editor__body {
    background: #fff;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    position: relative;
    transition: border-color 120ms ease, box-shadow 120ms ease;
}

.collaborative-editor__body:focus-within {
    border-color: #059669;
    box-shadow: 0 0 0 2px rgba(5, 150, 105, 0.18);
}

.collaborative-editor__body--disabled {
    background: #f8fafc;
}

.collaborative-editor__content {
    padding: 0.75rem;
}

.collaborative-editor__content :deep(.collaborative-editor__tiptap) {
    min-height: var(--editor-min-height);
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
}

.collaborative-editor__content :deep(.collaborative-editor__tiptap p) {
    margin: 0;
}

.collaborative-editor__content :deep(.collaborative-editor__tiptap p + p) {
    margin-top: 0.4rem;
}

.collaborative-editor__placeholder {
    color: #94a3b8;
    left: 0.75rem;
    pointer-events: none;
    position: absolute;
    top: 0.75rem;
}

.collaborative-editor__content :deep(.collaboration-carets__caret) {
    border-left: 2px solid;
    border-right: 2px solid;
    margin-left: -2px;
    margin-right: -2px;
    pointer-events: none;
    position: relative;
    word-break: normal;
}

.collaborative-editor__content :deep(.collaboration-carets__label) {
    border-radius: 4px;
    color: #fff;
    font-size: 0.7rem;
    font-weight: 700;
    left: -2px;
    line-height: 1;
    padding: 0.18rem 0.35rem;
    position: absolute;
    top: -1.35rem;
    user-select: none;
    white-space: nowrap;
}

.collaborative-editor__content :deep(.collaboration-carets__selection) {
    opacity: 0.22;
}
</style>
