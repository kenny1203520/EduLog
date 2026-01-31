import { supabase } from '@/lib/supabase'
import { Report, type ReportDTO } from '@/models/Report'

export class ReportService {
  private static instance: ReportService

  private constructor() {}

  public static getInstance(): ReportService {
    if (!ReportService.instance) {
      ReportService.instance = new ReportService()
    }
    return ReportService.instance
  }

  /**
   * Fetch all reports for a specific student
   */
  async getByStudentId(studentId: string): Promise<Report[]> {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('student_id', studentId)
      .order('date', { ascending: false })
    
    if (error) throw new Error(error.message)
    
    return (data as ReportDTO[]).map(dto => new Report(dto))
  }

  /**
   * Get a single report by ID
   */
  async getById(id: string): Promise<Report | null> {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) throw new Error(error.message)
    if (!data) return null

    return new Report(data as ReportDTO)
  }

  /**
   * Create a new report
   */
  async create(report: Partial<ReportDTO>): Promise<Report> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')

    const { data, error } = await supabase
      .from('reports')
      .insert({ ...report, user_id: user.id })
      .select()
      .single()

    if (error) throw new Error(error.message)

    return new Report(data as ReportDTO)
  }

  /**
   * Update an existing report
   */
  async update(id: string, updates: Partial<ReportDTO>): Promise<Report> {
    const { data, error } = await supabase
      .from('reports')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)

    return new Report(data as ReportDTO)
  }

  /**
   * Delete a report
   */
  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('reports')
      .delete()
      .eq('id', id)
    
    if (error) throw new Error(error.message)
  }
}
