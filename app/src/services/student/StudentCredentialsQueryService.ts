import { apiV1Client } from '@/services/api/ApiV1Client'
import type { StudentCredentialDTO } from '@/models/Student'

/** Sensitive credential data is intentionally fetched outside the page read model. */
export class StudentCredentialsQueryService {
  static async getForStudent(studentId: string): Promise<StudentCredentialDTO[]> {
    const response = await apiV1Client.get<StudentCredentialDTO[]>(`/students/${encodeURIComponent(studentId)}/credentials`)
    return response.data ?? []
  }
}
