// Strict calendar dates; never let Date.parse guess a year or locale.
(() => {
  const valid = (year, month, day) => Number.isInteger(year) && year >= 1000 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  const iso = (year, month, day) => valid(year, month, day) ? `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : null
  function parse(value) {
    const raw = String(value || '').trim()
    const full = raw.match(/(?<!\d)(\d{4})\s*(?:[-/.]|年)\s*(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})(?:日)?(?!\d)/)
    if (full) return { raw, date: iso(Number(full[1]),Number(full[2]),Number(full[3])), month:Number(full[2]), day:Number(full[3]), hasYear:true }
    const partial = raw.match(/(?<![\d\-/\.])(\d{1,2})\s*(?:[-/.]|月)\s*(\d{1,2})(?:日)?(?![\d\-/\.])/)
    if (!partial) return { raw, date:null, hasYear:false }
    const month=Number(partial[1]), day=Number(partial[2])
    return { raw, date:null, month, day, hasYear:false, valid:valid(2000,month,day) }
  }
  function resolve(values, ranges = []) {
    const parsed=values.map(parse), dates=[...new Set(parsed.map(p=>p.date).filter(Boolean))]
    const partials=parsed.filter(p=>!p.hasYear && p.valid)
    if (dates.length > 1 || parsed.some(p=>p.hasYear && !p.date)) return { date:null, conflict:true, reason:'來源日期互相矛盾或包含無效日期，請確認完整上課日期。' }
    if (dates.length === 1) {
      if (partials.some(p=>p.month!==Number(dates[0].slice(5,7)) || p.day!==Number(dates[0].slice(8,10)))) return { date:null, conflict:true, reason:'記錄入口與歷史課次的日期不同，請核對原站。' }
      return { date:dates[0], basis:'source', conflict:false }
    }
    if (new Set(partials.map(p=>`${p.month}/${p.day}`)).size > 1) return { date:null, conflict:true, reason:'來源提供了不同月日，請確認完整上課日期。' }
    const candidates=new Set()
    for (const p of partials) for (const range of ranges) {
      const start=parse(range[0]).date,end=parse(range[1]).date
      if (!start || !end || start>end || Number(end.slice(0,4))-Number(start.slice(0,4))>10) continue
      for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++) { const date=iso(year,p.month,p.day); if(date && date>=start && date<=end)candidates.add(date) }
    }
    return candidates.size===1 ? { date:[...candidates][0],basis:'course_range',conflict:false } : { date:null,conflict:false,reason:partials.length?'原站只提供月日，尚無法唯一確認年份。':'原站尚未提供完整上課日期。' }
  }
  const today = () => { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-') }
  globalThis.edulogSourceDate = { parse, resolve, iso, today }
})()
