const fields = ['attendance_status','absence_reason','lesson_id','progress_letter','is_completed','class_participation','classroom_behavior','content','contact_notes','class_notes','external_link']

export async function fingerprintReport(record, { includeInternal = false, target = null, instance = '' } = {}) {
  const cryptoApi = globalThis.crypto?.subtle
  if (!cryptoApi) throw Object.assign(new Error('REPORT_DECISION_CRYPTO_UNAVAILABLE'), { code: 'REPORT_DECISION_CRYPTO_UNAVAILABLE' })
  const enc = new TextEncoder()
  const hash = async value => [...new Uint8Array(await cryptoApi.digest('SHA-256', enc.encode(JSON.stringify(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  const values = {}
  for (const key of fields) {
    if (key === 'class_notes' && !includeInternal) continue
    const supplied = (record.sourceFields || []).filter(field => field.key === key && (!field.internal || includeInternal))
    const source = supplied.length ? supplied.map(field => ({ provided: true, value: field.value ?? field.text ?? null, disabled: field.disabled === true })) : Object.hasOwn(record.data || {}, key) ? [{ provided: true, value: record.data[key] }] : [{ provided: false }]
    values[key] = await hash(source)
  }
  // Internal notes have a separate permission/read-scope toggle. Keep them in
  // per-field comparison when readable, but don't make a scope change look like
  // a source edit to the whole report.
  const publicValues = Object.fromEntries(Object.entries(values).filter(([key]) => key !== 'class_notes'))
  const contentFingerprint = await hash({ date: record.date || record.dateRaw || null, fields: publicValues })
  const contextFingerprint = await hash({ instance: new URL(instance || globalThis.location?.origin || 'http://localhost').origin, sourceOrigin: 'https://corp.orangeapple.co', adapter: 'orange-apple-v1', admission: String(record.enrollment_source_id), report: String(record.source_id || ''), student: String(record.student_source_id||''), target: target ? { enrollment: target.id || null, course: target.courseId || null, session: target.classSessionId || null } : null })
  return { content_fingerprint: contentFingerprint, context_fingerprint: contextFingerprint, field_fingerprints: values }
}

export function skipReviewReason(decision) {
  if (decision?.reason === 'context_changed') return 'context_changed'
  if (decision?.reason === 'content_changed') return 'content_changed'
  if (decision?.reason === 'expired' || decision?.expired) return 'expired'
  return 'legacy'
}
