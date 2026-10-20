/**
 * Built-in prompt for the AI report assistant.
 *
 * Every free-text value passed in here must already be de-identified. Bump
 * {@link REPORT_PROMPT_VERSION} whenever the wording changes so generation
 * logs can tell which prompt produced an output.
 */

export const REPORT_PROMPT_VERSION = 'report.v1'

export const REPORT_TONES = ['warm', 'formal', 'concise'] as const
export const REPORT_LENGTHS = ['short', 'medium', 'long'] as const
export type ReportTone = typeof REPORT_TONES[number]
export type ReportLength = typeof REPORT_LENGTHS[number]

export interface ReportPromptOptions {
  tone: ReportTone
  length: ReportLength
  /** Teacher's extra instructions (sanitized). */
  extraInstructions?: string
}

export interface PreviousReportContext {
  date: string
  content: string
  participation?: number | null
  behavior?: number | null
}

/** Sanitized facts about one lesson; placeholders such as [學生A] stand in for people. */
export interface ReportPromptContext {
  studentToken: string
  courseName: string
  subject?: string | null
  stage?: string | null
  lessonTitle?: string | null
  progressStart?: string | null
  progressEnd?: string | null
  isCompleted?: boolean | null
  attendance: 'pending' | 'present' | 'absent'
  absenceReason?: string | null
  participation?: number | null
  behavior?: number | null
  classNotes: string
  /** "Today's focus" typed in the assistant panel. */
  focus?: string
  /** Text already in the 學習報告 field; treated as the teacher's draft. */
  draft?: string
  /** Teacher's report template, used only as a format reference. */
  template?: string
  previousReports: PreviousReportContext[]
}

const TONE_TEXT: Record<ReportTone, string> = {
  warm: '溫暖、鼓勵，像老師親自寫給家長',
  formal: '正式、專業、條理清楚',
  concise: '精簡扼要，只講重點',
}

const LENGTH_TEXT: Record<ReportLength, string> = {
  short: '全文約 80–150 字',
  medium: '全文約 150–300 字',
  long: '全文約 300–500 字',
}

export interface BuiltPrompt {
  version: string
  system: string
  prompt: string
}

/** Key of the overridable system rules in ai_prompt_versions. */
export const REPORT_SYSTEM_PROMPT_KEY = 'report.system'

/** An administrator override of the system rules (see ai_prompt_versions). */
export interface PromptOverride {
  version: number
  body: string
}

/**
 * Built-in system rules. Administrators may replace them; tone and length are
 * always appended so the panel's choices keep working with any override.
 */
export const DEFAULT_REPORT_SYSTEM_RULES = [
    '你是補習班老師的課後報告助手，使用繁體中文（台灣用語）。',
    '你要產出兩樣東西：',
    '1. sections：給家長閱讀的學習報告，依序為 today（今日學習）、performance（課堂表現）、home（居家建議）。',
    '2. teachingSuggestions：只給老師看的內部教學建議（1–3 點，具體可執行，例如下次上課的調整）。這些內容絕對不可出現在 sections 裡。',
    '規則：',
    '- 方括號佔位符（例如 [學生A]、[老師A]）代表真實人名或資料，必須逐字保留，不可改寫、翻譯、加空白或自行編造名字。',
    '- 不可推測學生性別，不使用「他／她」，以佔位符或「孩子」稱呼。',
    '- 只根據提供的資料撰寫，不可捏造沒有提到的事件、成績或行為。資料不足時寫得保守簡短。',
    '- 負面狀況要委婉、具建設性，並搭配具體的改進方向。',
    '- 若有「老師草稿」，那是老師已寫好的內容：保留其中所有事實與用語，在此基礎上潤飾、擴寫並補齊缺少的段落。',
    '- 若有「報告樣板」，只參考它的格式與段落安排，不要照抄其中的範例內容。',
    '- sections 是給這位學生的家長看的：不要提到其他同學的名字（需要時寫「同學」），不要寫電話、Email、身分證或地址等聯絡資料。',
    '- 除了上述佔位符，不要使用方括號，也不要寫「[家長您好]」這類待填欄位。',
].join('\n')

/** Build the system and user prompt for one generation. */
export function buildReportPrompt(context: ReportPromptContext, options: ReportPromptOptions, override?: PromptOverride | null): BuiltPrompt {
  const rules = override?.body.trim() || DEFAULT_REPORT_SYSTEM_RULES
  const system = `${rules}\n- 語氣：${TONE_TEXT[options.tone]}。長度：${LENGTH_TEXT[options.length]}。`

  const lines: string[] = []
  lines.push(`學生：${context.studentToken}`)
  // A display name like "Scratch 程式設計 階段 2" already carries subject and stage.
  const extras = [context.subject, context.stage].filter((part): part is string => Boolean(part))
  const redundant = extras.length > 0 && extras.every((part) => context.courseName.includes(part))
  lines.push(`課程：${[context.courseName, ...(redundant ? [] : extras)].filter(Boolean).join(' / ')}`)
  if (context.lessonTitle) lines.push(`本次課次：${context.lessonTitle}`)
  if (context.progressStart || context.progressEnd) {
    lines.push(`進度：${context.progressStart ?? '?'} → ${context.progressEnd ?? '?'}${context.isCompleted ? '（本課已完成）' : ''}`)
  } else if (context.isCompleted != null) {
    lines.push(`本課${context.isCompleted ? '已完成' : '尚未完成'}`)
  }
  lines.push(`出缺席：${attendanceText(context)}`)
  if (context.participation != null) lines.push(`課程參與：${context.participation}/5`)
  if (context.behavior != null) lines.push(`課堂秩序：${context.behavior}/5`)
  section(lines, '課堂筆記（老師記錄）', context.classNotes)
  section(lines, '今日重點（老師補充）', context.focus)
  section(lines, '老師草稿', context.draft)
  section(lines, '報告樣板（僅供格式參考）', context.template)
  if (context.previousReports.length > 0) {
    lines.push('', '## 近期報告（由新到舊，供延續語氣與追蹤進步）')
    for (const report of context.previousReports) {
      const ratings = [
        report.participation != null ? `參與 ${report.participation}/5` : null,
        report.behavior != null ? `秩序 ${report.behavior}/5` : null,
      ].filter(Boolean).join('，')
      lines.push(`- ${report.date}${ratings ? `（${ratings}）` : ''}：${report.content.trim()}`)
    }
  }
  section(lines, '老師的額外指示', options.extraInstructions)

  const version = override ? `${REPORT_SYSTEM_PROMPT_KEY}.override.v${override.version}` : REPORT_PROMPT_VERSION
  return { version, system, prompt: lines.join('\n') }
}

function attendanceText(context: ReportPromptContext): string {
  if (context.attendance === 'present') return '出席'
  if (context.attendance === 'absent') return `缺席${context.absenceReason ? `（${context.absenceReason}）` : ''}`
  return '未記錄'
}

function section(lines: string[], title: string, body: string | undefined | null): void {
  const text = body?.trim()
  if (text) lines.push('', `## ${title}`, text)
}

export interface ContextWarning {
  code: 'missing_lesson_title' | 'thin_class_notes' | 'attendance_not_recorded'
}

/** Minimum characters of notes + focus before the panel stops nudging the teacher. */
export const THIN_NOTES_THRESHOLD = 30

/**
 * Rule-based check shown before generating; the panel asks the teacher to
 * fill "today's focus" when it returns warnings. It never blocks generation.
 */
export function assessReportContext(context: Pick<ReportPromptContext, 'lessonTitle' | 'classNotes' | 'focus' | 'draft' | 'attendance'>): ContextWarning[] {
  const warnings: ContextWarning[] = []
  if (!context.lessonTitle?.trim()) warnings.push({ code: 'missing_lesson_title' })
  const material = [context.classNotes, context.focus, context.draft].map((text) => text?.trim() ?? '').join('')
  if (material.length < THIN_NOTES_THRESHOLD) warnings.push({ code: 'thin_class_notes' })
  if (context.attendance === 'pending') warnings.push({ code: 'attendance_not_recorded' })
  return warnings
}
