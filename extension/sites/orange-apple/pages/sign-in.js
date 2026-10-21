// Sign-in and password pages: one card around the native Devise form.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  function signInCard({ doc, content, page, scope }) {
    const { element, mark, move } = scope
    const lexicon = globalThis.edulogSiteLexicon
    const form = content.querySelector(lexicon.selectors.signInForm) || content.querySelector(lexicon.selectors.passwordForm)
    if (!form) return
    const signIn = page.kind === 'sign-in'
    const card = scope.add(element('section')); card.className = 'edulog-signin'
    const head = element('header')
    head.append(element('h2', signIn ? tx('登入 Corp') : tx('重設密碼')), element('p', signIn ? tx('使用原站帳號登入；EduLog 不會讀取或保存你的密碼。') : tx('輸入帳號 Email，原站會寄送重設密碼說明。')))
    card.append(head)
    content.prepend(card)
    const alert = content.querySelector('#flash .alert, .alert')
    if (alert) { mark(alert, 'data-edulog-signin-alert', ''); move(alert, card) }
    for (const heading of content.querySelectorAll('h2')) if (!card.contains(heading)) mark(heading, 'data-edulog-replaced', '')
    move(form, card)
    for (const [id, label] of [['employee_email', '電子郵件'], ['employee_password', '密碼'], ['employee_remember_me', '記住我']]) {
      const field = form.querySelector(`#${id}`)
      if (!field) continue
      const text = form.querySelector(`label[for="${id}"]`)
      if (text) scope.text(text, tx(label)); else mark(field, 'aria-label', tx(label))
    }
    const submit = form.querySelector('input[type=submit][name=commit]')
    if (submit && signIn) { mark(submit, 'value', tx('登入')); mark(submit, 'data-disable-with', tx('登入中…')) }
    const footer = element('footer')
    for (const link of [...content.querySelectorAll('a[href^="/employees/"]')].filter(a => !card.contains(a))) {
      if (/\/employees\/password\/new$/.test(link.getAttribute('href') || '')) scope.text(link, tx('忘記密碼？'))
      else if (/\/employees\/sign_in$/.test(link.getAttribute('href') || '')) scope.text(link, tx('返回登入'))
      move(link, footer)
    }
    const locales = doc.querySelector('#page-body > .sidebar .locale-selector')
    if (locales) move(locales, footer)
    if (footer.children.length) card.append(footer)
  }
  kit.page(['sign-in', 'password'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    signInCard(context)
  })
})()
