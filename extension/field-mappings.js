// Canonical teaching semantics shared by import, workspace and the native editor.
// This script has no storage or credentials; confirmed rules come from the broker.
(() => {
  const attendance = { present: '出席', absent: '未出席', pending: '待確認' }
  const reasons = { busy_with_schoolwork:'課業繁忙', school_event:'校慶/運動會/畢業典禮', family_matter:'家裡有事', sick_or_injured:'生病/受傷', reason_not_provided:'未告知原因', travel_abroad:'出國', holiday:'休假日', family_ceremony:'喜慶/喪假', school_activity:'學校活動', suspension:'停課/停學', other:'其他原因' }
  const empty = value => value === '' || value === undefined || value === null
  const signature = field => JSON.stringify((field.options || []).map(o => [String(o.value),o.label,Boolean(o.disabled)]))
  const learningStatus = Object.freeze({on_track:'能跟上進度',hard_to_follow:'跟不上進度 (太難)',distracted:'跟不上進度 (分心)'})
  function splitClassNotes(value='') {
    const text=String(value),matches=[...text.matchAll(/^\[corp\.learning_status:([^\]\r\n]+)\]\r?\n([\s\S]*?)\r?\n\[\/corp\.learning_status\](?:\r?\n\r?\n|$)/gm)]
    if(!matches.length)return {status:null,notes:text,marked:false,invalid:false}
    if(matches.length!==1)return {status:null,notes:text,marked:true,invalid:true}
    const match=matches[0],status=Object.hasOwn(learningStatus,match[1])&&match[2].trim()===learningStatus[match[1]]?match[1]:null
    const notes=(text.slice(0,match.index)+text.slice(match.index+match[0].length)).trim()
    return {status,rawStatus:match[2].trim(),notes,marked:true,invalid:!status}
  }
  function composeClassNotes(status, notes='', rawStatus='') {
    const label=learningStatus[status]
    const value=label?`[corp.learning_status:${status}]\n${label}\n[/corp.learning_status]`:rawStatus?`[corp.learning_status:unmapped]\n${String(rawStatus).trim()}\n[/corp.learning_status]`:''
    return [value,String(notes||'').trim()].filter(Boolean).join('\n\n')
  }
  function scalar(field, option) {
    const label = (option?.label || '').trim(), value = option?.value
    if (field.key === 'attendance_status') {
      if (/^(出席|到課|present)$/i.test(label)) return 'present'
      if (/^(不出席|未出席|缺席|未到課|absent)$/i.test(label)) return 'absent'
      if (/^(待確認|未確認|pending)$/i.test(label)) return 'pending'
    }
    if (field.key === 'absence_reason') return Object.entries(reasons).find(([code,text]) => label === text || value === code)?.[0]
    if(field.key==='learning_status')return Object.entries(learningStatus).find(([code,name])=>code===value||name===label)?.[0]
    if (field.key === 'is_completed') {
      if (/^(完整完成|已完成|完成|已結課|all_done|complete|completed|是|yes)$/i.test(label) || /^(?:all_done|complete|completed)$/i.test(value||'')) return true
      if (/^(尚未完成|未完成|未結課|not_all_done|incomplete|否|no)$/i.test(label) || /^(?:not_all_done|incomplete)$/i.test(value||'')) return false
    }
    if (field.key === 'class_participation' || field.key === 'classroom_behavior') {
      if(field.type==='score'&&/^(?:[0-4](?:\.5)?|5)$/.test(String(value||'')))return Number(value)
    }
    if (['class_participation','classroom_behavior'].includes(field.key) && field.type === 'radio' && /^\d+$/.test(value || '') && Number(value) >= 0 && Number(value) <= 10) return Number(value)/2
    return undefined
  }
  function reportValue(field, report) {
    if (field.key.startsWith('progress_')) return report.progress_letter?.split('-')[field.key === 'progress_start' ? 0 : report.progress_letter.split('-').length-1]
    if(field.key==='learning_status')return splitClassNotes(report.class_notes||'').status
    if(field.key==='class_notes')return splitClassNotes(report.class_notes||'').notes
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
  globalThis.edulogFieldMappings = Object.freeze({ empty, signature, scalar, reportValue, display, suggest, canonical, equal, attendance, reasons, learningStatus, splitClassNotes, composeClassNotes })
})()
