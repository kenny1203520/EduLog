import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { StudentService } from '@/services/StudentService'
import { Student } from '@/models/Student'

export const useStudentStore = defineStore('student', () => {
  const students = ref<Student[]>([])
  const currentStudent = ref<Student | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const studentCount = computed(() => students.value.length)

  async function fetchAll() {
    loading.value = true
    error.value = null
    try {
      students.value = await StudentService.getAll()
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

  async function addStudent(name: string, grade?: string) {
    loading.value = true
    try {
      const newStudent = await StudentService.create({ name, grade })
      students.value.push(newStudent)
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
    loading,
    error,
    studentCount,
    fetchAll,
    loadStudent,
    addStudent
  }
})
