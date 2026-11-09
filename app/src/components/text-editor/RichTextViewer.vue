<template>
    <TextEditor :model-value="content" mode="read" :toolbar-visible="false"
        :formatting-enabled="false" :preset="preset" :font-scale="fontScale"
        :min-height="minHeight" :mono="mono" resize="none" />
</template>

<script setup lang="ts">
import TextEditor from './TextEditor.vue'
import type { TextEditorContentInput, TextEditorPreset } from './types'

withDefaults(defineProps<{
    content?: TextEditorContentInput
    preset?: TextEditorPreset
    fontScale?: number
    minHeight?: number
    mono?: boolean
}>(), { preset: 'form', minHeight: 0, mono: false })
</script>
