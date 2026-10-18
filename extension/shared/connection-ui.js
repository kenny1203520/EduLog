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
  globalThis.edulogUi?.register({
    'popup.settings': ['設定', 'Settings'],
  })
  globalThis.edulogConnectionUi = Object.freeze({
    describe(state) {
      const [chip, label, detail, tone] = states[state] || states.unavailable
      return { chip, label, detail, tone }
    },
    pageContext,
    tabHeading,
    // The single primary action for a connected popup, by page context.
    primaryAction(context, capabilities = {}) {
      if (context.kind === 'class') return { flow: 'import', label: '同步本班', icon: 'refresh', ready: capabilities.teaching_data_import === true }
      if (context.kind === 'report') return { flow: 'prefill', label: '預填本報告', icon: 'sparkles', ready: capabilities.report_prefill === true }
      return { flow: 'import', label: '開啟工作台', icon: 'dashboard', ready: true }
    },
    features(capabilities = {}) {
      // Server capability alone cannot enable a feature without a form adapter.
      return [
        { label: '教學資料匯入', serverEnabled: capabilities.teaching_data_import === true, available: capabilities.teaching_data_import === true },
        { label: '報告預填', serverEnabled: capabilities.report_prefill === true, available: capabilities.report_prefill === true },
      ].map(feature => ({ ...feature, detail: feature.available ? '可在整合工作台操作；未驗證資料需人工處理' : '伺服器尚未支援' }))
    },
  })
})()
