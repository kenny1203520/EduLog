// 個人資料 and its edit form.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['profile'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const heading = content.querySelector('h1,h2'), avatar = content.querySelector('img')
    if (heading) {
      const header = region(scope, '', 'edulog-profile-header'); heading.before(header); move(heading, header)
      if (avatar) { mark(avatar, 'data-edulog-profile-avatar', ''); move(avatar, header) }
      const edit = content.querySelector('a[href$="/edit"]'); if (edit) move(edit, header)
    }
    const sections = new Map()
    const lines = [...content.querySelectorAll('p > strong')].map(strong => strong.parentElement)
    for (const line of lines) {
      const label = text(line.querySelector('strong'))
      const name = /電話|地址|緊急聯絡|Email/i.test(label) ? '聯絡資訊' : /姓名|所屬區域|合作年資/.test(label) ? '基本資料' : '其他資訊'
      if (!sections.has(name)) { const section = region(scope, name); content.append(section); sections.set(name, section) }
      const siblings = line.parentElement
      const unit = siblings !== content && siblings.matches('div') && siblings.children[0] === line && !siblings.querySelector('a,form,h1,h2') && !siblings.querySelector('p > strong ~ strong') && siblings.querySelectorAll('strong').length === 1 ? siblings : line
      mark(unit, 'data-edulog-profile-field', ''); move(unit, sections.get(name))
    }
  })
  kit.page(['profile-edit'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const form = content.querySelector('form[action^="/my/"]'), inputs = form?.querySelector('.form-inputs')
    if (inputs) {
      mark(form, 'data-edulog-profile-form', '')
      const groups = new Map()
      for (const field of [...inputs.children]) {
        const control = field.querySelector('input:not([type=hidden]),select,textarea')
        if (!control) continue
        const name = /password/.test(control.id) ? '修改密碼' : /contact_/.test(control.id) ? '緊急聯絡人' : /skill|avatar/.test(control.id) ? '技能與照片' : '聯絡資訊'
        if (!groups.has(name)) {
          const group = name === '修改密碼' ? scope.add(element('details')) : region(scope, name)
          if (name === '修改密碼') {
            group.className = 'edulog-section'; group.append(element('summary', tx(name)), element('p', tx('不修改密碼請留空。修改後原站會強制登出。')))
            group.open = view.profilePasswordOpen === true || doc.activeElement?.type === 'password' || Boolean(inputs.querySelector('input[type=password][aria-invalid=true],.employee_password .error,.employee_password_confirmation .error'))
            listen(group,'toggle',()=>{view.profilePasswordOpen=group.open})
            // Reveal native validation failures before the browser focuses the field.
            listen(control, 'invalid', () => { group.open = true })
          }
          inputs.append(group); groups.set(name, group)
        }
        if (name === '修改密碼') listen(control, 'invalid', () => { groups.get(name).open = true })
        const label = field.querySelector('label'); if (label && control.id) mark(label, 'for', control.id)
        mark(field, 'data-edulog-profile-input', ''); move(field, groups.get(name))
      }
      for (const name of ['聯絡資訊','緊急聯絡人','技能與照片','修改密碼']) if (groups.has(name)) inputs.append(groups.get(name))
      const submit = form.querySelector('input[type=submit]'); if (submit) mark(submit, 'value', tx('儲存個人資料'))
    }
  })
})()
