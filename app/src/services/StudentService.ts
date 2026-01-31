import { supabase } from '@/lib/supabase'
import { Student, type StudentDTO } from '@/models/Student'

export class StudentService {
  /**
   * Fetch all students ordered by name
   */
  static async getAll(): Promise<Student[]> {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .order('name')
    
    if (error) throw new Error(error.message)
    
    return (data as StudentDTO[]).map(dto => new Student(dto))
  }

  /**
   * Get a single student by ID
   */
  static async getById(id: string): Promise<Student | null> {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', id)
      .single()
    
    if (error) throw new Error(error.message)
    if (!data) return null

    return new Student(data as StudentDTO)
  }

  /**
   * Create a new student
   */
  static async create(student: Partial<StudentDTO>): Promise<Student> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')

    const { data, error } = await supabase
      .from('students')
      .insert({ ...student, user_id: user.id })
      .select()
      .single()

    if (error) throw new Error(error.message)

    return new Student(data as StudentDTO)
  }

  /**
   * Update an existing student
   */
  static async update(id: string, updates: Partial<StudentDTO>): Promise<Student> {
    const { data, error } = await supabase
      .from('students')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw new Error(error.message)

    return new Student(data as StudentDTO)
  }
}
