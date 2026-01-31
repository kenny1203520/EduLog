import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ReportService } from '@/services/ReportService'
import { Report } from '@/models/Report'

export const useReportStore = defineStore('report', () => {
  const reports = ref<Report[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  
  const reportService = ReportService.getInstance()

  async function fetchByStudent(studentId: string) {
    loading.value = true
    error.value = null
    try {
      reports.value = await reportService.getByStudentId(studentId)
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  async function createReport(studentId: string, content: string, date: string) {
    loading.value = true
    try {
      const newReport = await reportService.create({
        student_id: studentId,
        content,
        date
      })
      // Add to beginning of list
      reports.value.unshift(newReport)
      return newReport
    } catch (e: any) {
      error.value = e.message
      throw e
    } finally {
      loading.value = false
    }
  }

  return {
    reports,
    loading,
    error,
    fetchByStudent,
    createReport
  }
})
