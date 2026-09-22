<script setup lang="ts">
import RolePermissionEditor from '@/components/settings/RolePermissionEditor.vue'

defineProps<{ teachings: Array<{ id: string; name: string }>; teachingId?: string }>()
</script>

<template>
    <RolePermissionEditor domain="teaching" :teachings="teachings" :teaching-id="teachingId" />
</template>
