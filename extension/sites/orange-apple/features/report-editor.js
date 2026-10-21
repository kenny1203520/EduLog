// Lesson report editor additions: a live four-status row, absent-only mode, rating clear,
// an inline phrase library, a collapsed staff-only field and a non-blocking pre-submit
// checklist. Field values only change through the native controls (with native events);
// submission is always the provider's own button.
(() => {
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const FIELDS = {
    attendance: '#lesson_report_attendance_status',
    reason: '#lesson_report_reason',
    stage: '#dt_admission_lesson_report_learning_stage',
    completion: '#dt_admission_lesson_report_completion_status',
    from: '#dt_admission_lesson_report_start_from',
    to: '#dt_admission_lesson_report_end_to',
    feedback: '#lesson_report_feedback',
    contact: '#dt_admission_lesson_report_contact',
    internal: '#admission_lesson_report_learning_status',
    staff: '#dt_admission_lesson_report_typing_error',
    confirm: '#nothing',
  }
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const ICONS = { check: ['M7 12.5l3.2 3.2L17 9'], cross: ['M8 8l8 8', 'M16 8l-8 8'], dash: ['M7 12h10'], triangle: ['M12 4l9 16H3z', 'M12 10v4'] }
  function icon(doc, name) {
    const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg')
    svg.setAttribute('data-edulog-owned', ''); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'edulog-icon')
    for (const shape of ICONS[name]) { const node = doc.createElementNS(ns, 'path'); node.setAttribute('d', shape); node.setAttribute('data-edulog-owned', ''); svg.append(node) }
    return svg
  }

  // 完成狀況 counts as filled once a status is chosen and both chapters are given; the class page
  // resolves its ambiguous yellow icon with the same rule after reading the saved report.
  function completionState(status, from, to) {
    const chapters = Boolean(from && to)
    if (status === 'all_done') return chapters ? 'done' : 'chapters'
    if (status === 'not_all_done') return chapters ? 'partial' : 'unfinished'
    return 'empty'
  }
  // The same four states as the session icons, read from the form as it is being filled.
  function readState(form) {
    const value = key => form.querySelector(FIELDS[key])?.value || ''
    const attendance = value('attendance') === 'attended' ? 'present' : value('attendance') === 'absent' ? 'absent' : 'unmarked'
    const completion = completionState(value('completion'), value('from'), value('to'))
    const internal = value('internal') === 'on_track' ? 'ok' : value('internal') ? 'behind' : 'empty'
    const performance = collapse(value('feedback')) ? 'done' : 'empty'
    return { attendance, completion, internal, performance, reason: value('reason'), confirmed: Boolean(form.querySelector(FIELDS.confirm)?.checked) }
  }
  const CELLS = {
    attendance: { present: ['ok', 'check', '出席'], absent: ['danger', 'cross', '不出席'], unmarked: ['warn', 'dash', '未點名'] },
    completion: { done: ['ok', 'check', '完整完成'], partial: ['ok', 'check', '尚未完成 · 已填章節'], chapters: ['warn', 'triangle', '章節未填'], unfinished: ['warn', 'triangle', '尚未完成 · 待補章節'], empty: ['warn', 'dash', '未填'] },
    internal: { ok: ['ok', 'check', '跟得上'], behind: ['danger', 'cross', '跟不上'], empty: ['warn', 'dash', '未選'] },
    performance: { done: ['ok', 'check', '已填寫'], empty: ['warn', 'dash', '未填'] },
  }
  function missingItems(state) {
    if (state.attendance === 'unmarked') return [['attendance', '出席狀況']]
    if (state.attendance === 'absent') return state.reason ? [] : [['reason', '不出席原因']]
    const items = []
    if (state.completion === 'empty') items.push(['completion', '完成狀況'])
    if (state.completion === 'chapters' || state.completion === 'unfinished') items.push(['from', '章節進度'])
    if (state.performance === 'empty') items.push(['feedback', '學習表現'])
    if (state.internal === 'empty') items.push(['internal', '內部紀錄'])
    if (state.performance === 'done' && !state.confirmed) items.push(['confirm', '確認學生姓名與上課資訊'])
    return items
  }

  // Phrase library from the provider's #report-options: categories, levels and sentences.
  function readPhrases(modal) {
    const options = modal.querySelector('#report-options')
    if (!options) return []
    return [...options.children].map(block => {
      const title = collapse(block.querySelector('h5')?.textContent)
      if (!title) return null
      const levels = [...block.querySelectorAll('.option-kind')].map(kind => ({
        level: collapse(kind.querySelector('h6')?.textContent) || '',
        phrases: [...kind.querySelectorAll('input.option-item')].map(input => input.value).filter(Boolean),
      })).filter(level => level.phrases.length)
      return levels.length ? { title, levels } : null
    }).filter(Boolean)
  }
  // Only "今天的進度第＿課" can be derived reliably; the earlier lesson stays for the teacher.
  const fillLesson = (phrase, lesson) => lesson === '' ? phrase : phrase.replace(/今天的進度第＿課/, `今天的進度第${lesson}課`)

  function enhance({ doc, modal, form, scope, sections }) {
    const { element, listen, mark, move } = scope
    const field = key => form.querySelector(FIELDS[key])
    const fire = (node, ...types) => { for (const type of types) node.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true })) }
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }

    // 1. Live four-status row at the top of the form.
    const strip = scope.add(element('ul')); strip.className = 'edulog-card-status edulog-editor-status'; strip.setAttribute('aria-label', tx('本堂狀態')); strip.setAttribute('aria-live', 'polite')
    form.prepend(strip)

    // 2. Absent: only the reason and the parent contact field apply.
    const notApplicable = [sections.get('課程與專案進度'), sections.get('課堂評量'), sections.get('內部紀錄'), field('feedback')?.closest('.form-group')].filter(Boolean)
    const absentNote = scope.add(dataText('p', tx('不出席：只需填寫不出席原因與聯絡欄，其他項目不適用。'), 'edulog-editor-note'))
    absentNote.hidden = true
    sections.get('出席狀況')?.append(absentNote)

    // 3. Ratings: a clear button next to each control (the native radios stay the source).
    for (const column of form.querySelectorAll('[data-edulog-rating-column]')) {
      const radios = [...column.querySelectorAll('input[type=radio]')]
      if (!radios.length) continue
      const clear = scope.add(element('button', tx('清除評分'))); clear.type = 'button'; clear.className = 'edulog-rating-clear'
      listen(clear, 'click', () => { for (const radio of radios) if (radio.checked) { radio.checked = false; fire(radio, 'input', 'change') } })
      column.append(clear)
    }

    // 4. Phrase library beside 學習表現: click a sentence to insert it at the cursor.
    const feedback = field('feedback'), phrases = readPhrases(modal)
    if (feedback && phrases.length) {
      const library = scope.add(element('section')); library.className = 'edulog-phrases'; library.setAttribute('aria-label', tx('學習表現片語'))
      const tabs = element('div'); tabs.className = 'edulog-phrase-tabs'; tabs.setAttribute('role', 'tablist')
      const panel = element('div'); panel.className = 'edulog-phrase-panel'; panel.setAttribute('role', 'tabpanel')
      library.append(dataText('h4', tx('片語庫')), tabs, panel)
      let active = 0
      const insert = phrase => {
        const text = fillLesson(phrase, field('stage')?.value ?? '')
        const start = feedback.selectionStart ?? feedback.value.length, end = feedback.selectionEnd ?? start
        feedback.value = feedback.value.slice(0, start) + text + feedback.value.slice(end)
        const caret = start + text.length
        feedback.focus(); feedback.setSelectionRange(caret, caret)
        fire(feedback, 'input', 'change')
      }
      const show = index => {
        active = index
        for (const [i, tab] of [...tabs.children].entries()) { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1 }
        const category = phrases[index]
        panel.replaceChildren(...category.levels.map(level => {
          const group = element('div'); group.className = 'edulog-phrase-level'
          if (level.level) group.append(dataText('h5', level.level, 'edulog-phrase-level-title'))
          const list = element('div'); list.className = 'edulog-phrase-list'
          for (const phrase of level.phrases) {
            const button = element('button'); button.type = 'button'; button.className = 'edulog-phrase'; button.textContent = phrase.trim()
            listen(button, 'click', () => insert(phrase.trim()))
            list.append(button)
          }
          group.append(list)
          return group
        }))
      }
      for (const [index, category] of phrases.entries()) {
        const tab = element('button'); tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.textContent = category.title
        listen(tab, 'click', () => show(index))
        listen(tab, 'keydown', event => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (!step) return
          event.preventDefault(); show((active + step + phrases.length) % phrases.length); tabs.children[active].focus()
        })
        tabs.append(tab)
      }
      show(0)
      feedback.closest('.form-group')?.after(library)
      for (const native of [modal.querySelector('#show-options'), modal.querySelector('#report-options')]) if (native) mark(native, 'data-edulog-replaced', '')
    }

    // 5. The staff-only field moves into a closed 「教學部使用」 block.
    const staff = field('staff')?.closest('.mb-2')
    if (staff) {
      const details = scope.add(element('details')); details.className = 'edulog-staff-only'
      details.append(dataText('summary', tx('教學部使用')))
      ;(sections.get('內部紀錄') || staff.parentElement).append(details)
      move(staff, details)
    }

    // 6. Non-blocking checklist beside the native submit; items jump to their field.
    const checklist = scope.add(element('div')); checklist.className = 'edulog-submit-check'; checklist.setAttribute('aria-live', 'polite')
    const footer = sections.get('確認與送出')
    if (footer) footer.prepend(checklist)

    function refresh() {
      const state = readState(form)
      strip.replaceChildren(...[['attendance', '出席'], ['completion', '完成狀況'], ['internal', '內部紀錄'], ['performance', '學習表現']].map(([key, label]) => {
        const [tone, iconName, word] = key !== 'attendance' && state.attendance === 'absent' ? ['neutral', 'dash', '不適用'] : CELLS[key][state[key]]
        const item = element('li'); item.dataset.tone = tone
        item.append(icon(doc, iconName), dataText('span', tx(label), 'edulog-card-status-label'), dataText('span', tx(word), 'edulog-card-status-value'))
        return item
      }))
      const absent = state.attendance === 'absent'
      absentNote.hidden = !absent
      for (const node of notApplicable) mark(node, 'data-edulog-not-applicable', absent ? '' : null)
      const missing = missingItems(state)
      checklist.replaceChildren()
      if (missing.length) {
        checklist.append(dataText('p', tx('尚未完成（仍可送出）：'), 'edulog-submit-check-title'))
        const list = element('ul')
        for (const [key, label] of missing) {
          const item = element('li'), jump = element('button', tx(label)); jump.type = 'button'
          listen(jump, 'click', () => { const target = field(key); target?.scrollIntoView?.({ block: 'center' }); target?.focus() })
          item.append(jump); list.append(item)
        }
        checklist.append(list)
      } else checklist.append(dataText('p', tx('必要項目都已填寫。'), 'edulog-submit-check-done'))
    }
    listen(form, 'input', refresh)
    listen(form, 'change', refresh)
    refresh()
    return { refresh }
  }
  globalThis.edulogSiteReportEditor = Object.freeze({ completionState, readState, missingItems, readPhrases, fillLesson, enhance })
})()
