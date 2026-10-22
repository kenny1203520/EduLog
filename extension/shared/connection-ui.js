(() => {
  // [chip, headline, detail, tone]. Tones follow MASTER §2: ok / warn / danger / neutral.
  const states = {
    checking: ['驗證中', '正在驗證連線', '請稍候…', 'neutral'],
    'not-connected': ['未連線', '尚未連接 EduLog', '連接後即可同步班級、預填報告。', 'neutral'],
    pending: ['等待核准', '等待 EduLog 核准', '請在 EduLog 核准連線，再回來完成配對。', 'warn'],
    'pairing-expired': ['未連線', '配對已逾時', '請重新建立配對請求。', 'warn'],
    connected: ['已連線', 'EduLog 已連線', '連線已驗證。', 'ok'],
    expired: ['連線已過期', '連線已過期', '請重新連接 EduLog。清晰主題仍可使用。', 'warn'],
    revoked: ['授權已撤銷', '授權已撤銷', '請重新連接 EduLog。清晰主題仍可使用。', 'warn'],
    forbidden: ['連線異常', '伺服器未允許此擴充套件', '請檢查伺服器的擴充套件來源設定，再重新驗證。', 'danger'],
    unavailable: ['連線異常', '暫時無法驗證', '目前連線資料已保留，請確認伺服器可連線後重試。', 'danger'],
    'context-invalidated': ['需要重新開啟', '擴充套件已更新', '請先儲存正在編輯的內容，再重新整理分頁。', 'warn'],
  }
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  // What the active tab is, so the popup can offer one action for it. Patterns come from
  // the site lexicon; tabs on other hosts (no URL without host permission) are "other".
  function pageContext(href, lexicon = globalThis.edulogSiteLexicon) {
    let url
    try { url = new URL(href) } catch { return { kind: 'other', supported: false } }
    const supported = url.origin === 'https://corp.orangeapple.co'
    if (!supported || !lexicon) return { kind: 'other', supported }
    const { paths } = lexicon
    if (paths.classPage.test(url.pathname)) return { kind: 'class', supported, classId: /\/courses\/dt\/(\d+)/.exec(url.pathname)[1] }
    const report = paths.reportEditor.exec(url.pathname)
    if (report) return { kind: 'report', supported, admissionId: report[1], reportId: report[2] }
    return { kind: 'other', supported }
  }
  // Source tab titles end with the provider's site name; keep the part the teacher recognises.
  const tabHeading = title => String(title || '').split(/\s[|｜–—-]\s/)[0].trim()
  // English for the same states, keyed as conn.<state>.<chip|label|detail> for extension-owned UI.
  const english = {
    checking: ['Checking', 'Checking connection', 'Please wait…'],
    'not-connected': ['Not connected', 'Not connected to EduLog', 'Connect to sync classes and prefill reports.'],
    pending: ['Awaiting approval', 'Waiting for EduLog approval', 'Approve the connection in EduLog, then finish pairing here.'],
    'pairing-expired': ['Not connected', 'Pairing expired', 'Start a new pairing request.'],
    connected: ['Connected', 'EduLog connected', 'Connection verified.'],
    expired: ['Expired', 'Connection expired', 'Reconnect EduLog. The light theme still works.'],
    revoked: ['Access revoked', 'Access revoked', 'Reconnect EduLog. The light theme still works.'],
    forbidden: ['Connection error', 'Server blocks this extension', 'Check the server\'s extension origin setting, then verify again.'],
    unavailable: ['Connection error', 'Can\'t verify right now', 'Your connection is kept. Check the server is reachable, then retry.'],
    'context-invalidated': ['Reopen needed', 'Extension updated', 'Save your work, then reload the tab.'],
  }
  globalThis.edulogUi?.register({
    'popup.settings': ['設定', 'Settings'],
    ...Object.fromEntries(Object.entries(states).flatMap(([state, zh]) => ['chip', 'label', 'detail'].map((part, index) => [`conn.${state}.${part}`, [zh[index], english[state][index]]]))),
  })
  globalThis.edulogConnectionUi = Object.freeze({
    describe(state) {
      const key = states[state] ? state : 'unavailable'
      const [chip, label, detail, tone] = states[key]
      return { chip, label, detail, tone, key: `conn.${key}` }
    },
    pageContext,
    tabHeading,
    // The single primary action for a connected popup, by page context.
    primaryAction(context, capabilities = {}) {
      if (context.kind === 'class') return { flow: 'import', label: tx('同步本班'), icon: 'refresh', ready: capabilities.teaching_data_import === true }
      if (context.kind === 'report') return { flow: 'prefill', label: tx('預填本報告'), icon: 'sparkles', ready: capabilities.report_prefill === true }
      return { flow: 'import', label: tx('開啟工作台'), icon: 'dashboard', ready: true }
    },
    features(capabilities = {}) {
      // Server capability alone cannot enable a feature without a form adapter.
      return [
        { label: tx('教學資料匯入'), serverEnabled: capabilities.teaching_data_import === true, available: capabilities.teaching_data_import === true },
        { label: tx('報告預填'), serverEnabled: capabilities.report_prefill === true, available: capabilities.report_prefill === true },
      ].map(feature => ({ ...feature, detail: tx(feature.available ? '可在整合工作台操作；未驗證資料需人工處理' : '伺服器尚未支援') }))
    },
  })
})()
