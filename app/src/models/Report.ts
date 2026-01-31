export interface ReportDTO {
  id: string
  created_at: string
  content: string
  date: string
  student_id: string
  user_id: string // Although we don't strictly need to expose this in UI, it's good for type safety
}

export class Report {
  public id: string
  public created_at: Date
  public content: string
  public date: string // YYYY-MM-DD
  public student_id: string

  constructor(dto: ReportDTO) {
    this.id = dto.id
    this.created_at = new Date(dto.created_at)
    this.content = dto.content || ''
    this.date = dto.date
    this.student_id = dto.student_id
  }

  /**
   * Helper to format date for UI
   */
  get formattedDate(): string {
    return new Date(this.date).toLocaleDateString()
  }

  public toDTO(): Partial<ReportDTO> {
    return {
      content: this.content,
      date: this.date,
      student_id: this.student_id
    }
  }
}
