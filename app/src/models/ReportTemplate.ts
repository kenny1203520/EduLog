/**
 * ReportTemplate represents a reusable template for learning reports.
 * Includes content, contact notes, and class notes.
 */

export interface ReportTemplateDTO {
    id?: string
    name: string
    content: string
    contact_notes?: string
    class_notes?: string
    instructor_id: string
    created_at?: string
    updated_at?: string
}

export class ReportTemplate {
    id?: string
    name: string
    content: string
    contactNotes?: string
    classNotes?: string
    instructorId: string
    createdAt?: Date
    updatedAt?: Date

    constructor(data: ReportTemplateDTO) {
        this.id = data.id
        this.name = data.name
        this.content = data.content
        this.contactNotes = data.contact_notes
        this.classNotes = data.class_notes
        this.instructorId = data.instructor_id
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    toDTO(): Partial<ReportTemplateDTO> {
        return {
            id: this.id,
            name: this.name,
            content: this.content,
            contact_notes: this.contactNotes,
            class_notes: this.classNotes,
            instructor_id: this.instructorId
        }
    }
}
