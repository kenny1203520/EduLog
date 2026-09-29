(() => {
  const adapter = globalThis.edulogSiteAdapter
  if (!adapter?.matchesHost(location.hostname) || !adapter.matchesTeachingPage(location.pathname) || document.getElementById('edulog-extension-root')) return

  const host = document.createElement('div')
  host.id = 'edulog-extension-root'
  host.style.position = 'fixed'
  host.style.zIndex = '2147483000'
  host.style.inset = 'auto 0 24px auto'
  host.style.width = 'min(380px, calc(100vw - 24px))'
  host.style.height = 'min(640px, calc(100vh - 48px))'
  host.style.pointerEvents = 'none'
  document.documentElement.append(host)
  const root = host.attachShadow({ mode: 'closed' })
  const styles = document.createElement('style')
  styles.textContent = `
    :host { all: initial; color: #172033; font: 14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
    * { box-sizing: border-box; }
    button { font: inherit; cursor: pointer; }
    .launcher { pointer-events: auto; position: absolute; right: 16px; bottom: 0; width: 48px; height: 48px; border: 0; border-radius: 15px; background: #1e40af; color: white; box-shadow: 0 8px 24px #0f172a38; font-size: 15px; font-weight: 800; }
    .panel { pointer-events: auto; position: absolute; right: 12px; bottom: 60px; display: none; width: calc(100% - 24px); max-height: calc(100% - 72px); overflow: auto; border: 1px solid #cbd5e1; border-radius: 18px; background: #f8fafc; box-shadow: 0 18px 50px #0f172a40; }
    .panel[data-open="true"] { display: block; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 16px; background: white; border-bottom: 1px solid #e2e8f0; }
    h2 { margin: 0; font-size: 16px; }
    .close { min-width: 40px; min-height: 40px; border: 0; border-radius: 10px; background: transparent; color: #475569; font-size: 20px; }
    nav { display: flex; gap: 6px; padding: 10px 12px; overflow-x: auto; background: white; }
    nav button { min-height: 40px; border: 1px solid #cbd5e1; border-radius: 10px; background: white; padding: 0 10px; color: #334155; white-space: nowrap; }
    nav button[aria-current="page"] { border-color: #1e40af; background: #eff6ff; color: #1e40af; }
    section { margin: 12px; padding: 16px; border: 1px solid #e2e8f0; border-radius: 14px; background: white; }
    p { margin: 8px 0 0; color: #475569; }
    .notice { border-left: 3px solid #d97706; padding-left: 10px; font-size: 12px; }
    .status { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; background: #f1f5f9; padding: 5px 9px; color: #475569; font-size: 12px; font-weight: 700; }
    .status::before { width: 7px; height: 7px; border-radius: 50%; background: #94a3b8; content: ""; }
    .status[data-state="connected"] { background: #ecfdf5; color: #047857; }
    .status[data-state="connected"]::before { background: #10b981; }
    .status[data-state="revoked"], .status[data-state="expired"], .status[data-state="unavailable"] { background: #fff7ed; color: #b45309; }
    .status[data-state="revoked"]::before, .status[data-state="expired"]::before, .status[data-state="unavailable"]::before { background: #f59e0b; }
    .link { display: inline-flex; align-items: center; min-height: 40px; margin-top: 12px; border: 0; border-radius: 9px; background: #1e40af; padding: 0 12px; color: white; font-weight: 700; }
    .link:disabled { cursor: not-allowed; background: #94a3b8; }
    @media (max-width: 480px) { .panel { right: 8px; bottom: 60px; width: calc(100% - 16px); max-height: calc(100% - 68px); } }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior: auto !important; transition: none !important; } }
  `
  const frame = document.createElement('div')
  frame.innerHTML = `<button class="launcher" type="button" aria-label="開啟 EduLog" aria-expanded="false">E</button>
    <main class="panel" role="region" aria-label="EduLog 教學工作區" data-open="false">
      <header><div><h2>EduLog 工作區</h2><p>教學系統整合</p></div><button class="close" type="button" aria-label="關閉面板">×</button></header>
      <section><strong>EduLog 連線</strong><p><span class="status" data-state="checking" role="status" aria-live="polite">正在檢查連線</span></p><p class="connection-detail">正在確認目前 EduLog 系統。</p></section>
      <section><strong>教學資料與報告</strong><p class="feature-status">資料匯入與報告預填尚待完成網站欄位驗證。</p><p class="notice">此面板目前不讀取或修改教學系統資料，也不會代替你送出表單。</p><button class="link" type="button" disabled>前往 EduLog 整合設定</button></section>
    </main>`
  root.append(styles, frame)
  const launcher = root.querySelector('.launcher')
  const panel = root.querySelector('.panel')
  const statusBadge = root.querySelector('.status')
  const statusDetail = root.querySelector('.connection-detail')
  const featureStatus = root.querySelector('.feature-status')
  const settingsButton = root.querySelector('.link')
  settingsButton.addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'open-edulog-settings' }) })
  const statusLabels = {
    'not-connected': ['未連線', '請點選瀏覽器工具列中的 EduLog 圖示，設定並連接自架 EduLog 系統。'],
    expired: ['連線已過期', '請從 EduLog 擴充套件視窗重新連線。'],
    revoked: ['連線已撤銷', '請從 EduLog 擴充套件視窗重新連線。'],
    unavailable: ['暫時無法連線', '請確認 EduLog 伺服器可用，稍後再試。'],
  }
  chrome.runtime.sendMessage({ type: 'get-edulog-integration-status' }).then((result) => {
    if (!result) return
    if (result.status === 'connected') {
      statusBadge.dataset.state = 'connected'
      statusBadge.textContent = '已連線'
      statusDetail.textContent = '已連接目前設定的 EduLog 系統。'
      const capabilities = result.capabilities || {}
      featureStatus.textContent = capabilities.teaching_data_import && capabilities.report_prefill
        ? '資料匯入與報告預填已可使用。'
        : '匯入資料與報告預填尚待完成網站欄位驗證。'
      settingsButton.disabled = false
      return
    }
    const [label, detail] = statusLabels[result.status] || statusLabels.unavailable
    statusBadge.dataset.state = result.status
    statusBadge.textContent = label
    statusDetail.textContent = detail
  }).catch(() => {
    statusBadge.dataset.state = 'unavailable'
    statusBadge.textContent = '暫時無法連線'
    statusDetail.textContent = '請確認 EduLog 伺服器可用，稍後再試。'
  })
  function closePanel() { panel.dataset.open = 'false'; launcher.setAttribute('aria-expanded', 'false'); launcher.focus() }
  launcher.addEventListener('click', () => { panel.dataset.open = 'true'; launcher.setAttribute('aria-expanded', 'true'); root.querySelector('.close').focus() })
  root.querySelector('.close').addEventListener('click', closePanel)
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.dataset.open === 'true') closePanel() })
})()
