// Student learning-account modal: a platform list with masked, copyable credentials.
// Saving always goes through the provider's own forms and submit buttons; the extension
// only changes how they are shown, plus a reversible fix for broken format checks.
(() => {
  const lexicon = globalThis.edulogSiteLexicon
  if (!lexicon) return
  const config = lexicon.accounts
  const MASK = '••••••••'
  const EMAIL_PATTERN = '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')

  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  function readPlatforms(modal) {
    const body = modal.querySelector('.modal-body')
    const seen = new Set(), platforms = []
    for (const form of body?.querySelectorAll('form') || []) {
      const site = form.querySelector(config.siteField)?.value
      if (!site || seen.has(site) || !config.sites[site]) continue
      seen.add(site)
      const section = form.parentElement === body ? form : form.closest('.modal-body > div[id]') || form
      const username = form.querySelector(config.usernameField), password = form.querySelector(config.passwordField)
      const addButton = section.id ? [...body.querySelectorAll(config.addButton)].find(button => (button.getAttribute('onclick') || '').includes(`#${section.id}`)) : null
      platforms.push({ site, name: config.sites[site], form, section, username, password, addButton, configured: Boolean(collapse(username?.value)) })
    }
    return platforms
  }

  function enhance(doc, modal, scope) {
    const { element, listen, mark } = scope
    const body = modal.querySelector('.modal-body')
    const platforms = readPlatforms(modal)
    if (!body || !platforms.length) return null
    mark(modal, 'data-edulog-dialog', 'accounts')
    const root = scope.add(element('section'))
    root.className = 'edulog-accounts'; root.setAttribute('aria-label', tx('學習平台帳號'))
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const button = (label, className) => { const node = element('button', label); node.type = 'button'; if (className) node.className = className; return node }
    const copyButton = (label, read) => {
      const copy = button(tx('複製'), 'edulog-account-action')
      copy.setAttribute('aria-label', tx('複製{label}', { label }))
      let timer
      listen(copy, 'click', async () => {
        try {
          await doc.defaultView.navigator.clipboard.writeText(read())
          copy.textContent = tx('已複製')
        } catch { copy.textContent = tx('無法複製') }
        clearTimeout(timer)
        timer = doc.defaultView.setTimeout(() => { copy.textContent = tx('複製') }, 2000)
      })
      return copy
    }
    const setOpen = (platform, open, trigger) => {
      mark(platform.section, 'data-edulog-account-section', open ? 'open' : 'closed')
      if (trigger) { trigger.setAttribute('aria-expanded', String(open)); trigger.textContent = tx(open ? '收合' : '編輯') }
      if (open) platform.username?.focus({ preventScroll: false })
    }

    // Native sections stay in place and are shown only when edited or added.
    for (const platform of platforms) {
      mark(platform.section, 'data-edulog-account-section', 'closed')
      if (!platform.section.id) mark(platform.section, 'id', `edulog-account-${platform.site}`)
      // Mask the native password field too; its value and submission are unchanged.
      if (platform.password) {
        mark(platform.password, 'type', 'password'); mark(platform.password, 'autocomplete', 'off')
        const reveal = scope.add(button(tx('顯示密碼'), 'edulog-account-action'))
        reveal.setAttribute('aria-pressed', 'false')
        listen(reveal, 'click', () => {
          const shown = reveal.getAttribute('aria-pressed') !== 'true'
          reveal.setAttribute('aria-pressed', String(shown)); reveal.textContent = tx(shown ? '隱藏密碼' : '顯示密碼')
          mark(platform.password, 'type', shown ? 'text' : 'password')
        })
        platform.password.after(reveal)
      }
      // Fix the provider's broken email pattern; AnyDesk IDs are not email addresses.
      const pattern = platform.username?.getAttribute('pattern') || ''
      if (platform.username && config.brokenEmailPattern.test(pattern)) {
        if (platform.site === 'anydesk') { mark(platform.username, 'pattern', '.*') /* any ID; kept in place so restore keeps attribute order */; mark(platform.username, 'title', tx('請輸入 AnyDesk ID 或帳號')) }
        else { mark(platform.username, 'pattern', EMAIL_PATTERN); mark(platform.username, 'title', tx('請輸入 Email，例如 name@example.com')) }
      }
    }
    const addContainer = platforms.find(platform => platform.addButton)?.addButton.parentElement
    if (addContainer) mark(addContainer, 'data-edulog-replaced', '')

    const configured = platforms.filter(platform => platform.configured)
    const list = element('ul'); list.className = 'edulog-account-list'
    for (const platform of configured) {
      const item = element('li'); item.className = 'edulog-account'
      const head = element('div'); head.className = 'edulog-account-head'
      const edit = button(tx('編輯'), 'edulog-account-action'); edit.setAttribute('aria-expanded', 'false'); edit.setAttribute('aria-controls', platform.section.id)
      edit.setAttribute('aria-label', tx('編輯{name}帳號', { name: platform.name }))
      listen(edit, 'click', () => setOpen(platform, platform.section.getAttribute('data-edulog-account-section') !== 'open', edit))
      head.append(dataText('strong', platform.name), edit)
      const fields = element('dl'); fields.className = 'edulog-account-fields'
      const usernameLabel = tx(tx(config.usernameLabel[platform.site] || '帳號'))
      const userRow = element('div'), userValue = element('dd')
      const value = collapse(platform.username.value)
      userValue.append(dataText('code', value))
      if (platform.site === 'exam' && /^https?:\/\//.test(value)) { const open = element('a', tx('開啟')); open.href = value; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.className = 'edulog-account-action'; userValue.append(open) }
      userValue.append(copyButton(usernameLabel, () => collapse(platform.username.value)))
      userRow.append(dataText('dt', usernameLabel), userValue); fields.append(userRow)
      if (platform.password && platform.password.value) {
        const passRow = element('div'), passValue = element('dd')
        const secret = dataText('code', MASK, 'edulog-account-secret')
        const show = button(tx('顯示'), 'edulog-account-action'); show.setAttribute('aria-pressed', 'false'); show.setAttribute('aria-label', tx('顯示{name}密碼', { name: platform.name }))
        listen(show, 'click', () => {
          const shown = show.getAttribute('aria-pressed') !== 'true'
          show.setAttribute('aria-pressed', String(shown)); show.textContent = tx(shown ? '隱藏' : '顯示')
          secret.textContent = shown ? platform.password.value : MASK
        })
        passValue.append(secret, show, copyButton(tx('密碼'), () => platform.password.value))
        passRow.append(dataText('dt', tx('密碼')), passValue); fields.append(passRow)
      }
      item.append(head, fields)
      list.append(item)
    }
    root.append(configured.length ? list : dataText('p', tx('尚未設定任何平台帳號。'), 'edulog-account-empty'))

    const available = platforms.filter(platform => !platform.configured)
    if (available.length) {
      const add = element('div'); add.className = 'edulog-account-add'
      const label = element('label', tx('新增平台帳號')), select = element('select')
      select.setAttribute('aria-label', tx('選擇要新增的平台'))
      for (const platform of available) { const option = element('option'); option.value = platform.site; option.textContent = platform.name; select.append(option) }
      label.append(select)
      const go = button(tx('新增'), 'edulog-account-action edulog-account-primary')
      listen(go, 'click', () => {
        const platform = available.find(item => item.site === select.value)
        if (!platform) return
        platform.addButton?.click() // the provider's own reveal, if it has one
        setOpen(platform, true)
      })
      add.append(label, go)
      root.append(add)
    }
    body.prepend(root)
    return { root: modal, form: modal.querySelector('form'), restore: scope.restore }
  }
  globalThis.edulogSiteAccounts = Object.freeze({ readPlatforms, enhance })
})()
