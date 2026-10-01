(() => {
  const states = {
    checking: ['正在驗證連線', '請稍候…', 'neutral'],
    'not-connected': ['尚未連線', '連接自架 EduLog，即可管理這個擴充套件的授權。', 'neutral'],
    pending: ['等待核准', '請在 EduLog 核准連線，再回來完成配對。', 'warning'],
    'pairing-expired': ['配對已逾時', '請重新建立配對請求。', 'warning'],
    connected: ['EduLog 已連線', '連線已驗證，可開啟 EduLog 管理整合授權。', 'success'],
    expired: ['連線已過期', '請重新連接 EduLog。網站 UI 改善仍可使用。', 'warning'],
    revoked: ['授權已撤銷', '請重新連接 EduLog。網站 UI 改善仍可使用。', 'warning'],
    forbidden: ['伺服器未允許此擴充套件', '請檢查伺服器的擴充套件來源設定，再重新驗證。', 'warning'],
    unavailable: ['暫時無法驗證', '目前連線資料已保留，請確認伺服器可連線後重試。', 'warning'],
    'context-invalidated': ['擴充套件已更新', '請先儲存正在編輯的內容，再重新整理分頁。', 'warning'],
  }
  globalThis.edulogConnectionUi = Object.freeze({
    describe(state) {
      const [label, detail, tone] = states[state] || states.unavailable
      return { label, detail, tone }
    },
    features(capabilities = {}) {
      // Server capability alone cannot enable a feature without a form adapter.
      return [
        { label: '教學資料匯入', serverEnabled: capabilities.teaching_data_import === true, available: false },
        { label: '報告預填', serverEnabled: capabilities.report_prefill === true, available: false },
      ].map(feature => ({ ...feature, detail: '目前版本尚未支援' }))
    },
  })
})()
