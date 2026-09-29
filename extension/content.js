(() => {
  const teachingPath = /(?:^|\/)(?:students?|courses?|classrooms?|classes?|sessions?|reports?|lessons?)(?:\/|$)/i.test(location.pathname)
  if (location.hostname !== 'corp.orangeapple.co' || !teachingPath || document.getElementById('edulog-extension-root')) return

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
    .link { display: inline-flex; align-items: center; min-height: 40px; margin-top: 12px; border: 0; border-radius: 9px; background: #1e40af; padding: 0 12px; color: white; font-weight: 700; }
    @media (max-width: 480px) { .panel { right: 8px; bottom: 60px; width: calc(100% - 16px); max-height: calc(100% - 68px); } }
    @media (prefers-reduced-motion: reduce) { *,*::before,*::after { scroll-behavior: auto !important; transition: none !important; } }
  `
  const frame = document.createElement('div')
  frame.innerHTML = `<button class="launcher" type="button" aria-label="開啟 EduLog" aria-expanded="false">E</button>
    <main class="panel" role="region" aria-label="EduLog 橘子蘋果整合" data-open="false">
      <header><div><h2>EduLog 工作區</h2><p>橘子蘋果教學頁</p></div><button class="close" type="button" aria-label="關閉面板">×</button></header>
      <nav aria-label="教學區域"><button type="button" aria-current="page">總覽</button><button type="button" disabled title="需完成網站樣本對應">學生</button><button type="button" disabled title="需完成網站樣本對應">課程與班級</button><button type="button" disabled title="需完成網站樣本對應">報告</button></nav>
      <section><strong>網站轉接器待驗證</strong><p>提供學生、課程、課次與報告頁的去識別化樣本後，才能安全對應資料欄位與原站操作。</p><p class="notice">目前不會讀取或修改原站資料，也不會代替你送出表單。</p><button class="link" type="button">開啟 EduLog 連線設定</button></section>
    </main>`
  root.append(styles, frame)
  const launcher = root.querySelector('.launcher')
  const panel = root.querySelector('.panel')
  root.querySelector('.link').addEventListener('click', () => { void chrome.runtime.sendMessage({ type: 'open-edulog-settings' }) })
  function closePanel() { panel.dataset.open = 'false'; launcher.setAttribute('aria-expanded', 'false'); launcher.focus() }
  launcher.addEventListener('click', () => { panel.dataset.open = 'true'; launcher.setAttribute('aria-expanded', 'true'); root.querySelector('.close').focus() })
  root.querySelector('.close').addEventListener('click', closePanel)
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.dataset.open === 'true') closePanel() })
})()
