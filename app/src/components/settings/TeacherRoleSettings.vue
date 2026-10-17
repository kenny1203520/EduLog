<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { RoleService } from '@/services/rbac/RoleService'
import type { RoleDTO } from '@/models/Rbac'
import { roleDisplayName } from '@/utils/roleDisplay'

const { t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
const roles = ref<RoleDTO[]>([])
const newRoleName = ref('')
const loading = ref(false)

async function loadRoles() {
    loading.value = true
    try {
        roles.value = await RoleService.getRoles()
    } catch (error: any) {
        reportError(error)
    } finally {
        loading.value = false
    }
}

async function addRole() {
    if (!newRoleName.value.trim()) return
    try {
        await RoleService.createRole(newRoleName.value)
        newRoleName.value = ''
        await loadRoles()
        toast.success(t('settings.teacher_roles.saved'))
    } catch (error: any) {
        reportError(error)
    }
}

async function removeRole(role: RoleDTO) {
    if (role.is_system) return
    try {
        await RoleService.deleteRole(role.id)
        await loadRoles()
        toast.success(t('settings.teacher_roles.deleted'))
    } catch (error: any) {
        reportError(error)
    }
}

onMounted(loadRoles)
</script>

<template>
    <section id="teacher-roles" class="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <div class="border-b border-gray-50 p-6 sm:p-8">
            <h3 class="text-2xl font-black tracking-tight text-gray-900">{{ $t('settings.teacher_roles.title') }}</h3>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.teacher_roles.description') }}</p>
        </div>
        <div class="space-y-5 p-6 sm:p-8">
            <form class="flex flex-col gap-3 sm:flex-row" @submit.prevent="addRole">
                <input v-model="newRoleName" :placeholder="$t('settings.teacher_roles.placeholder')"
                    class="min-w-0 flex-1 rounded-2xl border border-gray-200 bg-gray-50 px-5 py-3 font-bold outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10">
                <button type="submit" :disabled="!newRoleName.trim()"
                    class="rounded-2xl bg-emerald-600 px-6 py-3 font-black text-white transition hover:bg-emerald-700 disabled:opacity-40">
                    {{ $t('common.add') }}
                </button>
            </form>
            <div v-if="loading" class="py-8 text-center font-bold text-gray-400">{{ $t('common.loading') }}</div>
            <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div v-for="role in roles" :key="role.id"
                    class="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                    <div class="min-w-0">
                        <p class="truncate font-black text-gray-800">{{ roleDisplayName(role, t) }}</p>
                        <p class="text-[10px] font-black uppercase tracking-widest text-gray-400">
                            {{ role.is_system ? $t('settings.teacher_roles.system') : $t('settings.teacher_roles.custom') }}
                        </p>
                    </div>
                    <button v-if="!role.is_system" type="button" @click="removeRole(role)"
                        class="shrink-0 rounded-xl p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                        :aria-label="$t('common.delete')">×</button>
                </div>
            </div>
        </div>
    </section>
</template>
