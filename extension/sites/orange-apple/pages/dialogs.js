// Report, teaching-note, overall-comment and learning-account dialogs.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  function enhanceDialog(doc, view, scope) {
    const modal = doc.querySelector('#lesson-report-modal'), form = modal?.querySelector('form')
    if (!form) return null
    const { mark, element, listen, move } = scope
    mark(modal, 'data-edulog-dialog', '')
    if (view.reportTarget && form.getAttribute('action') === view.reportTarget.path.replace(/\/edit$/, '')) {
      const target = scope.add(element('p', tx('課次：{label}', { label: view.reportTarget.label }))); target.className = 'edulog-dialog-context'
      modal.querySelector('.modal-header')?.append(target)
    }
    const labels = {
      lesson_report_attendance_status: '出席狀況', lesson_report_reason: '不出席原因',
      dt_admission_lesson_report_learning_stage: '學習課程', dt_admission_lesson_report_completion_status: '完成狀況',
      dt_admission_lesson_report_start_from: '章節起點', dt_admission_lesson_report_end_to: '章節終點',
      lesson_report_feedback: '學習表現', lesson_report_comment: '內部紀錄', admission_lesson_report_learning_status: '學習狀況（內部）',
    }
    for (const [id, label] of Object.entries(labels)) {
      const input = form.querySelector(`#${id}`)
      if (!input) continue
      mark(input, 'aria-label', tx(label))
      const original = [...input.parentElement.querySelectorAll('label')].find(n => !n.htmlFor && site.isTerm(text(n), label))
      if (original) mark(original, 'for', id)
    }
    for (const row of [...form.children]) {
      if (row.querySelector('input,select,textarea') || !site.pattern('完成狀況', '章節進度').test(text(row))) continue
      for (const caption of [...row.children]) {
        const id = site.pattern('完成狀況').test(text(caption)) ? 'dt_admission_lesson_report_completion_status' : site.pattern('章節進度').test(text(caption)) ? 'dt_admission_lesson_report_start_from' : null
        const input = id && form.querySelector(`#${id}`)
        const column = input?.closest('.col-md-6,.col-md-4') || input?.parentElement
        if (column) { move(caption, column); mark(caption, 'data-edulog-field-caption', ''); mark(column, 'data-edulog-field-column', '') }
      }
      if (!text(row)) mark(row, 'data-edulog-duplicate-heading', '')
    }
    const sections = new Map()
    const group = name => {
      if (!sections.has(name)) { const box = region(scope, name, 'edulog-form-section'); form.append(box); sections.set(name, box) }
      return sections.get(name)
    }
    const children = [...form.children]
    for (const child of children) {
      if (child.matches('input[type=hidden],script,[data-edulog-owned]')) continue
      if (child.tagName === 'H4' && site.pattern('專案進度').test(text(child))) { mark(child, 'data-edulog-duplicate-heading', ''); continue }
      const ids = [child.id, ...[...child.querySelectorAll('[id]')].map(n => n.id)].join(' ')
      const fields = child.matches('input,select,textarea') ? [child] : [...child.querySelectorAll('input,select,textarea')]
      const name = /attendance_status|lesson_report_reason/.test(ids) ? '出席狀況'
        : /learning_stage|completion_status|start_from|end_to/.test(ids) ? '課程與專案進度'
        : fields.some(n => n.type === 'radio') ? '課堂評量'
        : /feedback|contact/.test(ids) ? '學習表現與聯絡欄'
        : /comment|learning_status|typing_error/.test(ids) ? '內部紀錄'
        : fields.some(n => n.type === 'submit' || n.type === 'checkbox') ? '確認與送出' : null
      // The source keeps completion/section captions in a separate row.
      const captions = !fields.length && site.pattern('完成狀況', '章節進度').test(text(child))
      if (name || captions) move(child, group(name || '課程與專案進度'))
    }
    const footer = sections.get('確認與送出'); if (footer) mark(footer, 'data-edulog-submit-region', '')
    for (const name of ['出席狀況','課程與專案進度','課堂評量','學習表現與聯絡欄','內部紀錄','確認與送出']) if (sections.has(name)) form.append(sections.get(name))
    for (const [name, label] of [['participation_rating', '課程參與'], ['order_rating', '課堂秩序']]) {
      const radios = [...form.querySelectorAll(`input[type=radio][name$="[${name}]"]`)]
      if (!radios.length) continue
      const wrapper = scope.add(element('label', tx('{label}評分', { label: tx(label) }))); wrapper.className = 'edulog-rating-control'
      const select = element('select'); select.setAttribute('aria-label', tx('{label}評分', { label: tx(label) }))
      const empty = element('option', tx('尚未評分')); empty.value = ''; select.append(empty)
      const halfStars = radios.length === 10 && radios.every(n => /^[1-9]$|^10$/.test(n.value))
      for (const radio of [...radios].sort((a,b) => Number(a.value)-Number(b.value))) {
        const option = element('option', halfStars ? tx('{stars} / 5 星', { stars: Number(radio.value)/2 }) : tx('原站評分 {value}', { value: radio.value }))
        option.value = radio.value; select.append(option)
        mark(radio, 'aria-label', `${tx(label)} ${option.textContent}`)
      }
      const sync = () => { select.value = radios.find(n => n.checked)?.value || '' }
      sync(); wrapper.append(select)
      const rating = radios[0].closest('.rating') || radios[0].parentElement
      mark(rating, 'data-edulog-rating-stars', '')
      for (const half of rating.querySelectorAll('label.half,.half')) mark(half, 'data-edulog-rating-half', '')
      const column = rating.closest('.col-md-6,.col-md-4') || rating.parentElement
      column.append(wrapper)
      mark(column, 'data-edulog-rating-column', '')
      listen(select, 'change', () => {
        const radio = radios.find(n => n.value === select.value)
        if (!radio) { sync(); return }
        radio.checked = true
        radio.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
        radio.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
      })
      for (const radio of radios) listen(radio, 'change', sync)
    }
    // Status row, absent-only mode, phrase library, staff-only block and pre-submit checklist.
    globalThis.edulogSiteReportEditor?.enhance({ doc, modal, form, scope, sections })
    const heading = modal.querySelector('.modal-title,h4')
    if (heading) { if (!heading.id) mark(heading, 'id', 'edulog-report-title'); mark(modal, 'aria-labelledby', heading.id) }
    mark(modal, 'role', 'dialog'); mark(modal, 'aria-modal', 'true')
    return { form, restore: scope.restore }
  }
  function enhanceDialogs(doc, view, createScope) {
    const entries = []
    const report = doc.querySelector('#lesson-report-modal form')
    if (report) { const scope = createScope(doc); const enhancement = enhanceDialog(doc,view,scope); if (enhancement) entries.push({root: report.closest('.modal'), ...enhancement}) }
    // These IDs and field structures have been inspected on the live site.
    for (const modal of doc.querySelectorAll('#edit-teacher-comment-modal,#teachers-comment-modal')) {
      const field = modal.querySelector('textarea'); if (!field) continue
      const scope = createScope(doc), title = modal.querySelector('.modal-title')
      scope.mark(modal,'data-edulog-dialog','compact'); scope.mark(modal,'role','dialog'); scope.mark(modal,'aria-modal','true')
      if (title) { if (!title.id) scope.mark(title,'id',`edulog-${modal.id}-title`); scope.mark(modal,'aria-labelledby',title.id) }
      scope.mark(field,'aria-label',modal.id === 'teachers-comment-modal' ? tx('學生總評') : tx('教學備註'))
      const close = modal.querySelector('button[data-bs-dismiss=modal],button[aria-label=Close]')
      if (close) { scope.mark(close,'data-edulog-close',''); scope.mark(close,'aria-label',tx('關閉視窗')) }
      const note = scope.add(scope.element('p',modal.id === 'teachers-comment-modal' ? tx('學生總評與每次課堂記錄分開儲存，請使用原站送出按鈕。') : tx('教學備註使用原站儲存機制；關閉視窗不代表已儲存。')))
      note.className = 'edulog-dialog-context'; field.before(note)
      entries.push({ root:modal, form:field.closest('form') || field, restore:scope.restore })
    }
    // Student learning-account modal: platform list, masked credentials, native forms.
    const accounts = globalThis.edulogSiteAccounts && doc.querySelector(globalThis.edulogSiteLexicon.accounts.modal)
    if (accounts) { const scope = createScope(doc); const enhancement = globalThis.edulogSiteAccounts.enhance(doc, accounts, scope); if (enhancement) entries.push(enhancement) }
    return { roots:entries.map(e=>e.root), isCurrent:()=>entries.every(e=>e.root.isConnected && (e.root.querySelector('form') || e.root.querySelector('textarea')) === e.form) && doc.querySelectorAll('#lesson-report-modal form,#edit-teacher-comment-modal textarea,#teachers-comment-modal textarea').length + (globalThis.edulogSiteAccounts ? doc.querySelectorAll('#accounts-modal .modal-body').length : 0) === entries.length, restore(){ for (const e of entries) e.restore() } }
  }
  globalThis.edulogSitePageDialogs = Object.freeze({ enhanceDialog, enhanceDialogs })
})()
