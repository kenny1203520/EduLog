import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { createTextEditorContent } from '@/components/text-editor/content'

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
    content_document?: RichTextDocumentV1 | null
    contact_notes_document?: RichTextDocumentV1 | null
    class_notes_document?: RichTextDocumentV1 | null
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
    contentDocument: RichTextDocumentV1
    contactNotesDocument: RichTextDocumentV1
    classNotesDocument: RichTextDocumentV1
    instructorId: string
    createdAt?: Date
    updatedAt?: Date

    constructor(data: ReportTemplateDTO) {
        this.id = data.id
        this.name = data.name
        const content = createTextEditorContent(data.content_document || data.content, { templateVariables: true })
        const contact = createTextEditorContent(data.contact_notes_document || data.contact_notes || '', { templateVariables: true })
        const classNotes = createTextEditorContent(data.class_notes_document || data.class_notes || '', { templateVariables: true })
        this.content = content.plainText
        this.contentDocument = content.richText
        this.contactNotes = contact.plainText
        this.contactNotesDocument = contact.richText
        this.classNotes = classNotes.plainText
        this.classNotesDocument = classNotes.richText
        this.instructorId = data.instructor_id
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    toDTO(): Partial<ReportTemplateDTO> {
        return {
            id: this.id,
            name: this.name,
            content: this.content,
            content_document: this.contentDocument,
            contact_notes: this.contactNotes,
            contact_notes_document: this.contactNotesDocument,
            class_notes: this.classNotes,
            class_notes_document: this.classNotesDocument,
            instructor_id: this.instructorId
        }
    }
}
