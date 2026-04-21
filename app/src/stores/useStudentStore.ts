import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { StudentService } from '@/services/StudentService'
import { Student } from '@/models/Student'

export const useStudentStore = defineStore('student', () => {
  const students = ref<Student[]>([])
  const currentStudent = ref<Student | null>(null)
  const searchQuery = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  const studentCount = computed(() => students.value.length)

  const pagination = ref({
    page: 1,
    perPage: 20,
    total: 0
  })

  async function fetchAll(page: number = 1, perPage: number = 20) {
    loading.value = true
    error.value = null
    try {
      const result = await StudentService.getAll(page, perPage, searchQuery.value)
      students.value = result.data
      pagination.value = {
        page,
        perPage,
        total: result.count
      }
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function loadStudent(id: string) {
    loading.value = true
    error.value = null
    try {
      currentStudent.value = await StudentService.getById(id)
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function addStudent(name: string) {
    loading.value = true
    try {
      const newStudent = await StudentService.create({ name })
      students.value.push(newStudent)
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function updateStudent(id: string, updates: any) {
    loading.value = true
    try {
      const updated = await StudentService.update(id, updates)
      // Update in list
      const idx = students.value.findIndex(s => s.id === id)
      if (idx !== -1) students.value[idx] = updated
      // Update current if matching
      if (currentStudent.value?.id === id) {
        // We reload to get relations too, or we could merge manually. 
        // Reloading is safer for full consistency.
        await loadStudent(id)
      }
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deleteStudent(id: string) {
    loading.value = true
    try {
      await StudentService.delete(id)
      students.value = students.value.filter(s => s.id !== id)
      if (currentStudent.value?.id === id) {
        currentStudent.value = null
      }
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    students,
    currentStudent,
    searchQuery,
    loading,
    error,
    studentCount,
    pagination,
    fetchAll,
    loadStudent,
    addStudent,
    updateStudent,
    deleteStudent
  }
})
