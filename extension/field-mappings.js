// Canonical teaching semantics shared by import, workspace and the native editor.
// This script has no storage or credentials; confirmed rules come from the broker.
(() => {
  const attendance = { present: '出席', absent: '未出席', pending: '待確認' }
  const reasons = { busy_with_schoolwork:'課業繁忙', school_event:'校慶/運動會/畢業典禮', family_matter:'家裡有事', sick_or_injured:'生病/受傷', reason_not_provided:'未告知原因', travel_abroad:'出國', holiday:'休假日', family_ceremony:'喜慶/喪假', school_activity:'學校活動', suspension:'停課/停學', other:'其他原因' }
  const empty = value => value === '' || value === undefined || value === null
  const signature = field => JSON.stringify((field.options || []).map(o => [String(o.value),o.label,Boolean(o.disabled)]))
  function scalar(field, option) {
    const label = (option?.label || '').trim(), value = option?.value
    if (field.key === 'attendance_status') {
      if (/^(出席|到課|present)$/i.test(label)) return 'present'
      if (/^(不出席|未出席|缺席|未到課|absent)$/i.test(label)) return 'absent'
      if (/^(待確認|未確認|pending)$/i.test(label)) return 'pending'
    }
    if (field.key === 'absence_reason') return Object.entries(reasons).find(([code,text]) => label === text || value === code)?.[0]
    if (field.key === 'is_completed') {
      if (/^(完整完成|已完成|完成|已結課|是|yes|completed)$/i.test(label)) return true
      if (/^(未完成|尚未完成|未結課|否|no|incomplete)$/i.test(label)) return false
    }
    if (['class_participation','classroom_behavior'].includes(field.key) && field.type === 'radio' && /^\d+$/.test(value || '') && Number(value) >= 0 && Number(value) <= 10) return Number(value)/2
    return undefined
  }
  function reportValue(field, report) {
    if (field.key.startsWith('progress_')) return report.progress_letter?.split('-')[field.key === 'progress_start' ? 0 : report.progress_letter.split('-').length-1]
    return report[field.key]
  }
  function display(field, report) {
    const value = reportValue(field,report)
    if (empty(value)) return '未填寫'
    if (field.key === 'attendance_status') return attendance[value] || '未辨識出席狀態'
    if (field.key === 'absence_reason') return reasons[value] || '未辨識缺席原因'
    if (field.key === 'is_completed') return typeof value === 'boolean' ? value ? '課程已完成' : '課程未完成' : '未辨識完成狀況'
    if (field.key === 'lesson_id') return report.lesson_name || `教材 #${String(value).slice(0,8)}`
    if (['class_participation','classroom_behavior'].includes(field.key)) return `${value} 星`
    return String(value)
  }
  function suggest(field, report, rules = []) {
    const value = reportValue(field,report)
    if (empty(value)) return ''
    if (field.type === 'text') return typeof value === 'string' ? value : ''
    // A reverse relation is usable only when exactly one live option matches.
    const remembered = rules.filter(r => r.valid !== false && r.field_key === field.key && r.options_signature === signature(field) && JSON.stringify(r.canonical_value) === JSON.stringify(value))
    const available = field.options.filter(o => !o.disabled)
    const matches = available.filter(o => remembered.some(r => r.source_value === o.value))
    if (remembered.length) return matches.length === 1 ? matches[0].value : ''
    const builtins = available.filter(o => {
      const known = scalar(field,o)
      if (known !== undefined) return known === value
      if (field.key === 'lesson_id') return report.lesson_name && o.label.trim() === report.lesson_name.trim()
      if (field.key.startsWith('progress_')) return o.label.trim() === value
      return false
    })
    return builtins.length === 1 ? builtins[0].value : ''
  }
  function canonical(field, rules = []) {
    const rule = rules.find(r => r.valid !== false && r.field_key === field.key && r.source_value === field.value && r.options_signature === signature(field))
    if (rule) return rule.canonical_value
    return scalar(field,field.options.find(o => o.value === field.value))
  }
  function equal(field, report, rules = []) {
    if (empty(field.value)) return false
    if (field.type === 'text') return field.value === reportValue(field,report)
    const source = canonical(field,rules)
    return source !== undefined && source === reportValue(field,report)
  }
  globalThis.edulogFieldMappings = Object.freeze({ empty, signature, scalar, reportValue, display, suggest, canonical, equal, attendance, reasons })
})()
