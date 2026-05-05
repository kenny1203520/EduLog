import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const usePreferencesStore = defineStore('preferences', () => {
    const globalFontScale = ref(Number(localStorage.getItem('globalFontScale')) || 100)
    const editorFontScale = ref(Number(localStorage.getItem('editorFontScale')) || 100)

    const MIN_SCALE = 70
    const MAX_SCALE = 200
    const STEP = 10

    // Apply global font scale to document root
    watch(globalFontScale, (val) => {
        localStorage.setItem('globalFontScale', val.toString())
        if (typeof document !== 'undefined') {
            document.documentElement.style.fontSize = `${val}%`
        }
    }, { immediate: true })

    watch(editorFontScale, (val) => {
        localStorage.setItem('editorFontScale', val.toString())
    })

    function adjustGlobalScale(delta: number) {
        const newVal = Number(globalFontScale.value) + delta
        if (newVal >= MIN_SCALE && newVal <= MAX_SCALE) {
            globalFontScale.value = newVal
        }
    }

    function adjustEditorScale(delta: number) {
        const newVal = Number(editorFontScale.value) + delta
        if (newVal >= MIN_SCALE && newVal <= MAX_SCALE) {
            editorFontScale.value = newVal
        }
    }

    return {
        globalFontScale,
        editorFontScale,
        adjustGlobalScale,
        adjustEditorScale,
        STEP
    }
})
