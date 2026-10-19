// EduLog shell on provider pages: the theme-on toolbar, the theme-off floating button and the
// shared panel (MASTER §6.12). Styles use --edulog-* tokens only; they inherit into the shadow root.
(() => {
  const ui = globalThis.edulogUi
  ui?.register({
    'shell.more': ['EduLog 更多', 'More EduLog options'],
    'shell.fab': ['EduLog（{state}）', 'EduLog ({state})'],
    'shell.panel': ['EduLog 功能', 'EduLog tools'],
    'shell.close': ['關閉 EduLog 功能', 'Close EduLog tools'],
    'shell.applyPage': ['本頁套用 EduLog', 'Use EduLog on this page'],
    'shell.applyPageHelp': ['清晰主題，不需連線', 'Light theme, no connection needed'],
    'shell.theme': ['套用 EduLog 清晰主題', 'EduLog light theme'],
    'shell.themeHelp': ['所有支援頁面；不需連線', 'All supported pages; no connection needed'],
    'shell.openWorkspace': ['開啟工作台', 'Open workspace'],
    'shell.workLog': ['工作紀錄', 'Work log'],
    'shell.syncClass': ['同步本班', 'Sync class'],
    'shell.prefill': ['預填本報告', 'Prefill report'],
    'shell.checking': ['正在檢查連線…', 'Checking connection…'],
    'shell.verified': ['最近驗證 {time}', 'Verified {time}'],
    'shell.connectHint': ['點瀏覽器工具列的 EduLog 圖示完成連線後，即可在這裡同步本班與預填報告。', 'Connect with the EduLog icon in the browser toolbar to sync classes and prefill reports here.'],
    'shell.notReady': ['這個連線未提供這項功能，請重新檢查連線。', 'This connection doesn\'t provide this. Check the connection again.'],
    'shell.retry': ['重新檢查', 'Check again'],
    'shell.diagnostics': ['診斷資訊', 'Diagnostics'],
    'shell.integrationSettings': ['開啟整合設定', 'Integration settings'],
    'shell.openFailed': ['無法開啟整合工作台。', 'Couldn\'t open the workspace.'],
  })
  const fallback = {
    'shell.more': 'EduLog 更多', 'shell.fab': 'EduLog（{state}）', 'shell.panel': 'EduLog 功能', 'shell.close': '關閉 EduLog 功能',
    'shell.applyPage': '本頁套用 EduLog', 'shell.applyPageHelp': '清晰主題，不需連線', 'shell.theme': '套用 EduLog 清晰主題', 'shell.themeHelp': '所有支援頁面；不需連線',
    'shell.openWorkspace': '開啟工作台', 'shell.workLog': '工作紀錄', 'shell.syncClass': '同步本班', 'shell.prefill': '預填本報告',
    'shell.checking': '正在檢查連線…', 'shell.verified': '最近驗證 {time}', 'shell.connectHint': '點瀏覽器工具列的 EduLog 圖示完成連線後，即可在這裡同步本班與預填報告。',
    'shell.notReady': '這個連線未提供這項功能，請重新檢查連線。', 'shell.retry': '重新檢查', 'shell.diagnostics': '診斷資訊', 'shell.integrationSettings': '開啟整合設定',
    'shell.openFailed': '無法開啟整合工作台。', 'ui.settings': '設定', 'ui.navigation': '網站導覽',
  }
  const fill = (text, params = {}) => text.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')
  // Keyed text with a Traditional Chinese fallback when the shared catalogue is not loaded.
  function label(el, key, params = {}, attribute) {
    if (globalThis.edulogUi) return globalThis.edulogUi.text(el, key, params, attribute)
    const value = fill(fallback[key] || key, typeof params === 'function' ? params() : params)
    if (attribute) el.setAttribute(attribute, value); else el.textContent = value
    return el
  }
  // Lucide paths (24×24, stroke 2). Static strings only.
  const paths = {
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    sparkles: '<path d="M9.94 14.06A2 2 0 0 0 8.5 12.6L2.4 11a.5.5 0 0 1 0-.96L8.5 8.4A2 2 0 0 0 9.94 7L11.5.9a.5.5 0 0 1 .96 0L14.06 7A2 2 0 0 0 15.5 8.4l6.1 1.6a.5.5 0 0 1 0 .96L15.5 12.6a2 2 0 0 0-1.44 1.44L12.46 20.1a.5.5 0 0 1-.96 0z"/>',
    dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  }
  const icon = (name, size = '') => `<svg class="ic${size ? ` ic-${size}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`
  const styles = `
:host{all:initial;position:fixed;inset:0 0 auto;z-index:var(--edulog-z-toolbar,1040);color:var(--edulog-text);font:var(--edulog-font-body)/var(--edulog-leading) var(--edulog-font);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
:host([data-enabled="false"]){inset:auto var(--edulog-space-4) var(--edulog-space-4) auto;max-width:calc(100vw - 2 * var(--edulog-space-4))}
*{box-sizing:border-box}
[hidden]{display:none!important}
p{margin:0}
button,select{font:inherit;color:inherit}
:is(button,select,summary,a):focus-visible{outline:3px solid var(--edulog-focus-ring);outline-offset:2px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ic{width:var(--edulog-icon-sm);height:var(--edulog-icon-sm);flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ic-lg{width:var(--edulog-icon);height:var(--edulog-icon)}
.spacer{flex:1}
.logo{width:24px;height:24px;flex:none;border-radius:var(--edulog-radius-sm);background:var(--edulog-primary-bright);color:var(--edulog-text-on-primary);display:inline-grid;place-items:center;font-weight:700;font-size:var(--edulog-font-caption);line-height:1}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:var(--edulog-control-height);padding:0 14px;border:1px solid transparent;border-radius:var(--edulog-radius-sm);background:none;font-size:var(--edulog-font-button);font-weight:600;line-height:var(--edulog-leading-tight);white-space:nowrap;cursor:pointer;transition:background var(--edulog-duration),border-color var(--edulog-duration),color var(--edulog-duration)}
.btn-primary{background:var(--edulog-primary-bright);color:var(--edulog-text-on-primary)}
.btn-primary:hover{background:var(--edulog-primary)}
.btn-secondary{background:var(--edulog-surface);border-color:var(--edulog-border-strong);color:var(--edulog-text)}
.btn-secondary:hover{background:var(--edulog-surface-muted)}
.btn-sm{min-height:var(--edulog-control-height-sm,30px);padding:0 10px}
.btn-block{width:100%;min-height:var(--edulog-touch-target)}
.btn-icon{width:var(--edulog-control-height);padding:0;color:var(--edulog-text-muted)}
.btn-icon:hover{background:var(--edulog-surface-muted);color:var(--edulog-text-strong)}
.btn:disabled{background:var(--edulog-surface-disabled);border-color:transparent;color:var(--edulog-text-subtle);cursor:not-allowed}
.conn{display:inline-flex;align-items:center;gap:6px;font-size:var(--edulog-font-caption);font-weight:500;color:var(--edulog-status-neutral-text);white-space:nowrap}
.conn .dot{width:var(--edulog-status-dot);height:var(--edulog-status-dot);flex:none;border-radius:50%;background:var(--edulog-status-neutral)}
.conn[data-tone="ok"]{color:var(--edulog-status-ok-text)}.conn[data-tone="ok"] .dot{background:var(--edulog-status-ok)}
.conn[data-tone="warn"]{color:var(--edulog-status-warn-text)}.conn[data-tone="warn"] .dot{background:var(--edulog-status-warn)}
.conn[data-tone="danger"]{color:var(--edulog-status-danger-text)}.conn[data-tone="danger"] .dot{background:var(--edulog-status-danger)}
/* Theme on: one sticky toolbar, one primary action, everything else behind "more". */
.bar{display:flex;align-items:center;gap:var(--edulog-space-2) var(--edulog-space-3);min-height:48px;padding:0 var(--edulog-space-3) 0 var(--edulog-space-4);background:var(--edulog-surface);border-bottom:1px solid var(--edulog-border);box-shadow:var(--edulog-shadow-bar)}
.menu{display:none}
.tb-title{display:flex;align-items:baseline;gap:10px;min-width:0;flex:1}
.tb-title .title{min-width:0;font-size:var(--edulog-font-button);font-weight:600;color:var(--edulog-text-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tb-sub{flex:none;font-size:var(--edulog-font-caption);color:var(--edulog-text-muted);white-space:nowrap}
.tb-actions{display:flex;align-items:center;gap:var(--edulog-space-2);flex:none}
.notice{padding:10px var(--edulog-space-4);background:var(--edulog-status-notice-soft);color:var(--edulog-status-notice-text);font-size:var(--edulog-font-caption);border-bottom:1px solid var(--edulog-border);overflow-wrap:anywhere}
@media(max-width:991px){.menu{display:inline-flex}.bar{padding-left:var(--edulog-space-2)}}
@media(max-width:767px){.tb-sub{display:none}.bar .conn-label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}
@media(max-width:480px){.bar>.logo{display:none}.bar{gap:var(--edulog-space-2)}}
/* Theme off: a single 40px button with a connection dot; the panel opens from it. */
.dock{display:flex;flex-direction:column;align-items:flex-end;gap:var(--edulog-space-2)}
.dock .notice{max-width:320px;border:1px solid var(--edulog-status-notice-soft);border-radius:var(--edulog-radius);box-shadow:var(--edulog-shadow-popover)}
.fab{position:relative;width:40px;height:40px;padding:0;display:grid;place-items:center;border:1px solid var(--edulog-border);border-radius:50%;background:var(--edulog-surface);box-shadow:var(--edulog-shadow-popover);cursor:pointer;transition:border-color var(--edulog-duration)}
.fab:hover,.fab[aria-expanded="true"]{border-color:var(--edulog-primary-border)}
.fab-dot{position:absolute;top:-1px;right:-1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--edulog-surface);background:var(--edulog-status-neutral)}
.fab-dot[data-tone="ok"]{background:var(--edulog-status-ok)}.fab-dot[data-tone="warn"]{background:var(--edulog-status-warn)}.fab-dot[data-tone="danger"]{background:var(--edulog-status-danger)}
/* Panel: a manual popover in the top layer, so no provider overflow or z-index can cover it. */
.panel{position:fixed;inset:auto;margin:0;padding:0;width:min(300px,calc(100vw - 2 * var(--edulog-space-4)));max-height:calc(100dvh - 88px);overflow:auto;overscroll-behavior:contain;border:1px solid var(--edulog-border);border-radius:var(--edulog-radius-lg);background:var(--edulog-surface);color:var(--edulog-text);box-shadow:var(--edulog-shadow-popover);font:var(--edulog-font-body)/var(--edulog-leading) var(--edulog-font);overflow-wrap:anywhere}
.panel:focus{outline:none}
.panel[data-place="bottom"]{right:var(--edulog-space-4);bottom:calc(var(--edulog-space-4) + 48px)}
.panel[data-place="top"]{top:calc(var(--edulog-toolbar-height,48px) + var(--edulog-space-1));right:var(--edulog-space-3);width:min(320px,calc(100vw - 2 * var(--edulog-space-2)));max-height:calc(100dvh - var(--edulog-toolbar-height,48px) - var(--edulog-space-4))}
@media(max-width:480px){.panel[data-place="top"]{right:var(--edulog-space-2)}}
.fp-head{display:flex;align-items:center;gap:var(--edulog-space-2);padding:6px 6px 6px var(--edulog-space-3);border-bottom:1px solid var(--edulog-border-soft)}
.fp-head .panel-title{font-size:var(--edulog-font-heading);font-weight:600;color:var(--edulog-text-strong);line-height:var(--edulog-leading-tight)}
.fp-body{display:grid;gap:var(--edulog-space-3);padding:var(--edulog-space-3)}
.fp-body:empty{display:none}
.switch{display:flex;align-items:center;justify-content:space-between;gap:var(--edulog-space-3);width:100%;min-height:var(--edulog-control-height);padding:0;border:0;border-radius:var(--edulog-radius-sm);background:none;text-align:left;cursor:pointer;color:var(--edulog-text);font-size:var(--edulog-font-body);font-weight:500}
.switch small{display:block;font-size:var(--edulog-font-caption);font-weight:400;color:var(--edulog-text-muted)}
.track{position:relative;flex:none;width:36px;height:20px;border-radius:var(--edulog-radius-pill);background:var(--edulog-border-strong);transition:background var(--edulog-duration)}
.track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--edulog-surface);transition:transform var(--edulog-duration)}
.switch[aria-checked="true"] .track{background:var(--edulog-primary-bright)}
.switch[aria-checked="true"] .track::after{transform:translateX(16px)}
.links{display:grid;gap:2px;margin:0 calc(-1 * var(--edulog-space-2))}
.linkrow{display:flex;align-items:center;gap:10px;width:100%;min-height:var(--edulog-control-height);padding:0 var(--edulog-space-2);border:0;border-radius:var(--edulog-radius-sm);background:none;color:var(--edulog-text);font-size:var(--edulog-font-button);font-weight:500;text-align:left;cursor:pointer;list-style:none}
.linkrow::-webkit-details-marker{display:none}
.linkrow:hover{background:var(--edulog-surface-muted)}
.linkrow .chev{margin-left:auto;color:var(--edulog-text-muted);transition:transform var(--edulog-duration)}
.preferences[open]>.linkrow .chev{transform:rotate(90deg)}
.fp-conn{display:flex;gap:10px;align-items:flex-start;font-size:var(--edulog-font-caption);color:var(--edulog-text-muted)}
.fp-conn .ic{margin-top:2px}
.fp-conn[data-tone="ok"] .ic{color:var(--edulog-status-ok)}
.fp-conn[data-tone="danger"] .ic{color:var(--edulog-status-danger)}
.fp-conn[data-tone="warn"] .ic{color:var(--edulog-status-warn)}
.fp-conn .status{color:var(--edulog-text-secondary)}
.fp-actions{display:flex;flex-wrap:wrap;gap:var(--edulog-space-2)}
.diagnostics summary{min-height:var(--edulog-control-height-sm,30px);display:flex;align-items:center;cursor:pointer;font-size:var(--edulog-font-caption);color:var(--edulog-text-muted)}
.diagnostics p{font-size:var(--edulog-font-tag);color:var(--edulog-text-muted);white-space:pre-wrap}
.fp-foot{border-top:1px solid var(--edulog-border-soft);padding:var(--edulog-space-1)}
.prefs-body{display:grid;gap:var(--edulog-space-3);padding:var(--edulog-space-2) var(--edulog-space-2) var(--edulog-space-3)}
.prefs-body select{width:100%;min-height:var(--edulog-control-height);padding:0 10px;border:1px solid var(--edulog-border-input);border-radius:var(--edulog-radius-sm);background:var(--edulog-surface);font-size:var(--edulog-font-body)}
.prefs-body .settings{justify-self:start}
.field{display:grid;gap:4px}
.lbl{font-size:var(--edulog-font-caption);font-weight:600;color:var(--edulog-text-secondary)}
@media(max-width:767px){.btn,.btn-sm,.linkrow,.switch,.prefs-body select{min-height:var(--edulog-touch-target)}.btn-icon{width:var(--edulog-touch-target)}.prefs-body select{font-size:var(--edulog-font-name)}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}`
  globalThis.edulogIntegrationUi = Object.freeze({
    theme: { name: 'EduLog 清晰主題', apply: '套用清晰主題', original: '使用原站主題' },
    styles,
    icon,
    label,
  })
})()
