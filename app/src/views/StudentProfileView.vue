<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useStudentStore } from '@/stores/useStudentStore'
import { StudentService } from '@/services/StudentService'

const route = useRoute()
const studentStore = useStudentStore()
const studentId = computed(() => route.params.id as string)

// Form State for Main Details
const form = ref({
  name: '',
  grade: '',
  gov_id: '',
  email: '',
  phone: '',
  residence_address: '',
  mailing_address: '',
  orange_apple_id: '',
  notes: ''
})

// UI State
const isSaving = ref(false)

// Load Data
onMounted(async () => {
  if (studentId.value) {
    await studentStore.loadStudent(studentId.value)
    populateForm()
  }
})

function populateForm() {
  const s = studentStore.currentStudent
  if (!s) return
  form.value = {
    name: s.name,
    grade: s.grade,
    gov_id: s.gov_id,
    email: s.email,
    phone: s.phone,
    residence_address: s.residence_address,
    mailing_address: s.mailing_address,
    orange_apple_id: s.orange_apple_id,
    notes: s.notes
  }
}

// --- Main Student Update ---
async function saveMainDetails() {
  isSaving.value = true
  try {
    await studentStore.updateStudent(studentId.value, form.value)
    // Success feedback could go here
  } catch (e) {
    console.error(e)
    alert('Failed to save details')
  } finally {
    isSaving.value = false
  }
}

// --- Contacts Management ---
const newContact = ref({ name: '', relation: '', phone: '', email: '' })
async function addContact() {
  if (!newContact.value.name) return
  try {
    await StudentService.addContact({ ...newContact.value, student_id: studentId.value })
    newContact.value = { name: '', relation: '', phone: '', email: '' } // Reset
    await studentStore.loadStudent(studentId.value) // Refresh
  } catch (e) {
    console.error(e)
  }
}
async function deleteContact(id: string) {
  if (!confirm('Remove this contact?')) return
  await StudentService.deleteContact(id)
  await studentStore.loadStudent(studentId.value)
}

// --- Schools Management ---
const newSchool = ref({ name: '', status: '' })
async function addSchool() {
  if (!newSchool.value.name) return
  try {
    await StudentService.addSchool({ ...newSchool.value, student_id: studentId.value })
    newSchool.value = { name: '', status: '' }
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
  }
}
async function deleteSchool(id: string) {
  if (!confirm('Remove this school?')) return
  await StudentService.deleteSchool(id)
  await studentStore.loadStudent(studentId.value)
}

// --- Credentials Management ---
const newCred = ref({ platform: 'Orange Apple', username: '', password: '', url: '' })
const platforms = ['Orange Apple', 'Roblox', 'Minecraft', 'Anydesk', 'Quiz Platform', 'Other']

async function addCredential() {
  if (!newCred.value.platform) return
  try {
    await StudentService.addCredential({ ...newCred.value, student_id: studentId.value })
    // Reset but keep platform? or reset all
    newCred.value = { platform: 'Orange Apple', username: '', password: '', url: '' }
    await studentStore.loadStudent(studentId.value)
  } catch (e) {
    console.error(e)
  }
}
async function deleteCredential(id: string) {
  if (!confirm('Delete this credential?')) return
  await StudentService.deleteCredential(id)
  await studentStore.loadStudent(studentId.value)
}
</script>

<template>
  <div v-if="studentStore.loading && !studentStore.currentStudent" class="p-8 text-center text-gray-500">
    Loading profile...
  </div>
  
  <div v-else-if="studentStore.currentStudent" class="max-w-4xl mx-auto p-6 space-y-8">
    
    <!-- Header -->
    <div class="flex items-center justify-between border-b pb-4">
      <div>
        <h1 class="text-3xl font-bold text-gray-800">{{ studentStore.currentStudent.name }}</h1>
        <p class="text-gray-500">{{ studentStore.currentStudent.grade }} • {{ studentStore.currentStudent.id }}</p>
      </div>
      <div class="space-x-3">
        <router-link 
          :to="`/dashboard/student/${studentId}`"
          class="text-emerald-600 hover:text-emerald-700 font-medium"
        >
          View Reports
        </router-link>
      </div>
    </div>

    <!-- Main Details Form -->
    <section class="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
      <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
        <span>👤</span> Personal Details
      </h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="space-y-1">
          <label class="text-sm font-medium text-gray-700">Full Name</label>
          <input v-model="form.name" type="text" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium text-gray-700">Grade / Class</label>
          <input v-model="form.grade" type="text" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>
        
        <div class="space-y-1">
          <label class="text-sm font-medium text-gray-700">Gov ID (身分證)</label>
          <input v-model="form.gov_id" type="text" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium text-gray-700">Orange Apple ID</label>
          <input v-model="form.orange_apple_id" type="text" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>

        <div class="space-y-1">
          <label class="text-sm font-medium text-gray-700">Email</label>
          <input v-model="form.email" type="email" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>
        <div class="space-y-1">
          <label class="text-sm font-medium text-gray-700">Phone</label>
          <input v-model="form.phone" type="tel" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>

        <div class="space-y-1 md:col-span-2">
          <label class="text-sm font-medium text-gray-700">Residence Address (戶籍地址)</label>
          <input v-model="form.residence_address" type="text" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>
        <div class="space-y-1 md:col-span-2">
          <label class="text-sm font-medium text-gray-700">Mailing Address (通訊地址)</label>
          <input v-model="form.mailing_address" type="text" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500">
        </div>
        
        <div class="space-y-1 md:col-span-2">
          <label class="text-sm font-medium text-gray-700">Notes</label>
          <textarea v-model="form.notes" rows="3" class="w-full border rounded px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-500"></textarea>
        </div>
      </div>

      <div class="mt-6 flex justify-end">
        <button 
          @click="saveMainDetails" 
          :disabled="isSaving"
          class="bg-emerald-600 text-white px-6 py-2 rounded shadow hover:bg-emerald-700 transition disabled:opacity-50"
        >
          {{ isSaving ? 'Saving...' : 'Save Details' }}
        </button>
      </div>
    </section>

    <!-- Sub Sections Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
      
      <!-- Contacts -->
      <section class="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
        <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
          <span>👨‍👩‍👧</span> Contacts
        </h2>
        
        <ul class="space-y-3 mb-6">
          <li v-for="c in studentStore.currentStudent.contacts" :key="c.id" class="flex justify-between items-start bg-gray-50 p-3 rounded">
            <div>
              <div class="font-bold text-gray-800">{{ c.name }} <span class="text-xs text-gray-500 font-normal">({{ c.relation }})</span></div>
              <div class="text-sm text-gray-600">{{ c.phone }}</div>
              <div class="text-sm text-gray-600">{{ c.email }}</div>
            </div>
            <button @click="deleteContact(c.id!)" class="text-red-400 hover:text-red-600">×</button>
          </li>
        </ul>

        <div class="border-t pt-4">
          <h3 class="text-sm font-bold text-gray-500 mb-2 uppercase">Add Contact</h3>
          <div class="grid grid-cols-2 gap-2 mb-2">
            <input v-model="newContact.name" placeholder="Name" class="border rounded px-2 py-1 text-sm">
            <input v-model="newContact.relation" placeholder="Relation" class="border rounded px-2 py-1 text-sm">
            <input v-model="newContact.phone" placeholder="Phone" class="border rounded px-2 py-1 text-sm">
            <input v-model="newContact.email" placeholder="Email" class="border rounded px-2 py-1 text-sm">
          </div>
          <button @click="addContact" class="w-full bg-gray-100 text-gray-600 py-1 rounded hover:bg-gray-200 text-sm font-medium">+ Add Contact</button>
        </div>
      </section>

      <!-- Schools -->
      <section class="bg-white p-6 rounded-lg shadow-sm border border-gray-100 h-fit">
        <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
          <span>🏫</span> Schools
        </h2>
        
        <ul class="space-y-3 mb-6">
          <li v-for="s in studentStore.currentStudent.schools" :key="s.id" class="flex justify-between items-center bg-gray-50 p-3 rounded">
            <div>
              <div class="font-bold text-gray-800">{{ s.name }}</div>
              <div class="text-xs text-gray-500">{{ s.status }}</div>
            </div>
            <button @click="deleteSchool(s.id!)" class="text-red-400 hover:text-red-600">×</button>
          </li>
        </ul>

        <div class="border-t pt-4">
          <h3 class="text-sm font-bold text-gray-500 mb-2 uppercase">Add School</h3>
          <div class="grid grid-cols-1 gap-2 mb-2">
            <input v-model="newSchool.name" placeholder="School Name" class="border rounded px-2 py-1 text-sm">
            <input v-model="newSchool.status" placeholder="Status (e.g. Graduated)" class="border rounded px-2 py-1 text-sm">
          </div>
          <button @click="addSchool" class="w-full bg-gray-100 text-gray-600 py-1 rounded hover:bg-gray-200 text-sm font-medium">+ Add School</button>
        </div>
      </section>

    </div>

    <!-- Credentials (Full Width) -->
    <section class="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
      <h2 class="text-xl font-bold mb-4 flex items-center gap-2">
        <span>🔑</span> App & Account Credentials
      </h2>
      
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm mb-6">
          <thead class="bg-gray-50">
            <tr>
              <th class="p-3 font-medium text-gray-500">Platform</th>
              <th class="p-3 font-medium text-gray-500">Username/Account</th>
              <th class="p-3 font-medium text-gray-500">Password</th>
              <th class="p-3 font-medium text-gray-500">URL</th>
              <th class="p-3 w-10"></th>
            </tr>
          </thead>
          <tbody class="divide-y">
            <tr v-for="cred in studentStore.currentStudent.credentials" :key="cred.id">
              <td class="p-3 font-medium text-gray-800">{{ cred.platform }}</td>
              <td class="p-3 text-gray-600">{{ cred.username }}</td>
              <td class="p-3 text-gray-600 font-mono bg-gray-50 rounded select-all">{{ cred.password }}</td>
              <td class="p-3 text-blue-500 underline truncate max-w-xs">
                 <a v-if="cred.url" :href="cred.url" target="_blank">{{ cred.url }}</a>
              </td>
              <td class="p-3 text-right">
                <button @click="deleteCredential(cred.id!)" class="text-red-400 hover:text-red-600 px-2">×</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="border-t pt-4 bg-gray-50 p-4 rounded-lg">
        <h3 class="text-sm font-bold text-gray-500 mb-3 uppercase">Add New Credential</h3>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
          <select v-model="newCred.platform" class="border rounded px-2 py-1 text-sm bg-white">
            <option v-for="p in platforms" :key="p" :value="p">{{ p }}</option>
          </select>
          <input v-model="newCred.username" placeholder="Username" class="border rounded px-2 py-1 text-sm">
          <input v-model="newCred.password" placeholder="Password" class="border rounded px-2 py-1 text-sm">
          <input v-model="newCred.url" placeholder="URL (Optional)" class="border rounded px-2 py-1 text-sm">
          <button @click="addCredential" class="bg-emerald-600 text-white rounded hover:bg-emerald-700 text-sm font-medium">Add</button>
        </div>
      </div>
    </section>

  </div>
</template>
