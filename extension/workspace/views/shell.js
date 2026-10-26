// Static skeleton of the workspace (prototype v2: two tabs, three import steps,
// detail + advanced drawers). The controllers find their controls by id, so this
// runs before any controller is created. Copy is keyed (views/strings.js).
import { h, icon } from '../../shared/render.js'
import { say } from './strings.js'

const T = (tag, key, props = {}, ...children) => say(h(tag, props, ...children), key)
const label = (key, forId, props = {}) => say(h('label', { for: forId, ...props }), key)
const btn = (id, key, cls = 'btn btn-secondary', props = {}, iconName) => {
  const node = h('button', { id, type: 'button', class: cls, ...props })
  if (iconName) node.append(icon(iconName))
  node.append(say(h('span'), key))
  return node
}
const iconBtn = (kind, drawer, name) => say(h('button', { type: 'button', class: `btn btn-icon ${kind}`, 'data-close-drawer': drawer }, icon(name, 'ic-lg')), kind === 'back' ? 'ws.backList' : 'ws.close', {}, 'aria-label')
const field = (key, forId, control, cls = 'field') => h('div', { class: cls }, label(key, forId), control)
const check = (id, key, checked = false) => h('label', { class: 'check' }, h('input', { id, type: 'checkbox', checked }), say(h('span'), key))
const select = (id, props = {}) => h('select', { id, class: 'select', ...props })
const input = (id, type = 'text', props = {}) => h('input', { id, type, class: 'input', ...props })

function header() {
  const locale = h('select', { id: 'workspace-locale', class: 'select select-sm' }, h('option', { value: 'zh-TW' }, '繁體中文'), h('option', { value: 'en' }, 'English'))
  say(locale, 'ws.language', {}, 'aria-label')
  return h('header', { class: 'ws-head' },
    h('h1', {}, h('span', { class: 'logo', 'aria-hidden': 'true' }, 'E'), say(h('span'), 'ws.title')),
    h('span', { class: 'spacer' }),
    h('span', { id: 'connection-pill', class: 'conn', 'data-tone': 'ok', hidden: true }, h('span', { class: 'dot' }), say(h('span', { id: 'instance-label' }), 'ws.connected')),
    locale)
}

function tabs() {
  const tab = (flow, key, iconName, extra) => h('button', { type: 'button', role: 'tab', 'data-flow': flow, 'aria-selected': 'false', id: `tab-${flow}` }, icon(iconName), say(h('span'), key), extra)
  const list = h('div', { class: 'ws-tabs', role: 'tablist' },
    tab('import', 'ws.tab.import', 'download'),
    tab('work', 'ws.tab.log', 'history', h('span', { id: 'work-tab-count', class: 'count', hidden: true })))
  say(list, 'ws.tabs', {}, 'aria-label')
  return list
}

function operationStatus() {
  return h('section', { id: 'operation-status', class: 'op-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', hidden: true },
    h('span', { class: 'op-indicator', 'aria-hidden': 'true' }),
    h('div', { class: 'op-copy' }, h('strong', { id: 'operation-title' }), h('p', { id: 'operation-detail' }), h('progress', { id: 'operation-progress', hidden: true })),
    btn('retry-work-recovery', 'ws.retryRecovery', 'btn btn-secondary', { hidden: true }),
    btn('cancel-read', 'ws.cancelRead', 'btn btn-ghost', { hidden: true }))
}

function stepper() {
  const steps = h('ol', { class: 'stepper', id: 'import-stepper' })
  say(steps, 'ws.steps', {}, 'aria-label')
  for (const n of [1, 2, 3]) {
    steps.append(h('li', { 'data-wizard-step': `import-${n}` },
      h('button', { type: 'button', 'data-stage-nav': `import:${n}` },
        h('span', { class: 'n' }, h('span', { class: 'n-num' }, String(n)), icon('check', 'n-done')),
        say(h('span', { class: 'step-label' }), `ws.step${n}`))))
  }
  return h('div', { class: 'stepper-wrap' }, steps, h('p', { id: 'stepper-compact', class: 'stepper-compact', 'aria-hidden': 'true' }))
}

function readStep() {
  const advanced = h('details', { class: 'adv', id: 'import-advanced' },
    h('summary', {}, icon('sliders'), say(h('span'), 'ws.advanced'), say(h('span', { class: 'caption adv-hint' }), 'ws.advancedHint'), icon('chev-down', 'chev')),
    h('div', { class: 'adv-body' },
      h('div', { class: 'field' }, say(h('span', { class: 'lbl' }), 'ws.range'), check('all-history', 'ws.allHistory', true),
        h('div', { class: 'date-range' }, field('ws.dateFrom', 'date-from', input('date-from', 'date', { required: true, disabled: true })), field('ws.dateTo', 'date-to', input('date-to', 'date', { required: true, disabled: true })))),
      h('div', { class: 'field' }, say(h('span', { class: 'lbl' }), 'ws.historyLabel'), check('read-history', 'ws.readHistory', true)),
      h('div', { class: 'field' }, say(h('span', { class: 'lbl' }), 'ws.internalLabel'), check('include-internal-notes', 'ws.internalNotes')),
      h('div', { class: 'field', id: 'source-picker' }, label('ws.sourceTab', 'source-tab'), select('source-tab'), h('p', { id: 'source-label', class: 'caption', 'data-source-raw': '' }))))
  return h('section', { id: 'import-scope', class: 'step-body' },
    h('section', { class: 'panel', 'aria-labelledby': 'read-title' },
      h('div', { class: 'panel-head' }, T('h2', 'ws.pickTitle', { id: 'read-title' }), T('p', 'ws.pickHelp', { id: 'read-help' })),
      h('ul', { id: 'class-list', class: 'rows', role: 'radiogroup', 'aria-labelledby': 'read-title' }),
      advanced),
    h('div', { class: 'actionbar' },
      h('span', { class: 'status', id: 'read-summary' }),
      h('span', { class: 'spacer' }),
      btn('retry-history-save', 'ws.retrySave', 'btn btn-secondary', { hidden: true }),
      h('button', { id: 'collect', type: 'button', class: 'btn btn-primary' }, icon('download'), say(h('span', { id: 'collect-label' }), 'ws.readThis'))))
}

function advancedDrawer() {
  const tab = (name, key, pane) => say(h('button', { type: 'button', role: 'tab', 'data-adv-tab': name, 'aria-selected': 'false', ...(pane ? { 'data-review-pane': pane } : {}) }), key)
  const tabs = h('div', { class: 'adv-tabs', role: 'tablist' }, tab('students', 'ws.adv.students', 'identity'), tab('reports', 'ws.adv.reports', 'reports'), tab('classes', 'ws.adv.classes'), tab('fields', 'ws.adv.fields'), tab('maint', 'ws.adv.maint'))
  say(tabs, 'ws.adv.title', {}, 'aria-label')
  const search = input('mapping-search', 'search', { autocomplete: 'off' }); say(search, 'ws.adv.searchPlaceholder', {}, 'placeholder')
  const filter = select('mapping-filter')
  for (const [value, text] of [['pending', '待處理'], ['all', '全部'], ['remembered', '已核對'], ['identity', '可靠識別'], ['missing', '需補資料'], ['verification', '待驗證'], ['conflict', '來源有矛盾'], ['invalid', '記憶需重核'], ['legacy', '舊資料需補讀'], ['skipped', '已略過']]) filter.append(h('option', { value }, text))
  const sectionTabs = h('div', { class: 'seg mapping-tabs' },
    h('button', { type: 'button', 'data-mapping-section': 'courses', 'aria-pressed': 'true' }, '來源課程'),
    h('button', { type: 'button', 'data-mapping-section': 'admissions', 'aria-pressed': 'false' }, '學生與報名'))
  say(sectionTabs, 'ws.adv.sections', {}, 'aria-label')
  const students = h('section', { class: 'adv-pane', 'data-adv-pane': 'students', id: 'identity-pane' },
    h('p', { id: 'mapping-summary', class: 'caption', role: 'status', 'aria-live': 'polite' }),
    h('section', { id: 'mapping-workbench', class: 'workbench', 'data-mobile-view': 'list' },
      h('div', { class: 'workbench-toolbar' }, sectionTabs),
      h('div', { class: 'workbench-columns' },
        h('aside', { id: 'mapping-list-pane', class: 'workbench-list' },
          h('div', { class: 'workbench-filters' }, field('ws.adv.search', 'mapping-search', search), field('ws.adv.filter', 'mapping-filter', filter)),
          h('div', { id: 'mapping-items', class: 'workbench-items' }),
          T('p', 'ws.adv.listEmpty', { id: 'mapping-list-empty', class: 'caption', hidden: true })),
        h('section', { id: 'mapping-editor-pane', class: 'workbench-editor' },
          h('button', { id: 'mapping-back', type: 'button', class: 'btn btn-ghost btn-sm workbench-back' }, icon('chev-left'), say(h('span'), 'ws.adv.backList')),
          h('header', { class: 'workbench-heading' }, h('h3', { id: 'mapping-editor-title', tabindex: '-1' }), h('p', { id: 'mapping-editor-subtitle', class: 'caption' })),
          T('p', 'ws.adv.pickItemHelp', { id: 'mapping-empty', class: 'caption' }),
          h('div', { id: 'course-mappings' }), h('div', { id: 'student-mappings' })))))
  const historyFilter = select('history-filter')
  for (const [value, text, key] of [['needs', '需要處理'], ['stale', '本輪待重新確認', 'work.staleFilter'], ['all', '全部'], ['bind', '可綁定課次'], ['history', '先存歷史'], ['linked', '已綁定'], ['skipped', '已略過']]) { const option = h('option', { value }, text); if (key) option.dataset.i18n = key; historyFilter.append(option) }
  const historyReason = select('history-reason')
  for (const [value, key] of [['all', 'work.allReasons'], ['identity', 'work.identity'], ['date', 'work.date'], ['field', 'work.field'], ['source', 'work.sourceConflict'], ['occurrence', 'work.occurrence'], ['conflict', 'work.overwrite']]) historyReason.append(h('option', { value, dataset: { i18n: key } }, key))
  const reports = h('section', { class: 'adv-pane', 'data-adv-pane': 'reports', id: 'history-sync', hidden: true },
    h('p', { id: 'history-sync-summary', class: 'caption', role: 'status', 'aria-live': 'polite' }),
    h('section', { id: 'history-batch-review' }),
    h('section', { id: 'history-stale-queue', class: 'history-stale-queue', hidden: true, 'aria-live': 'polite' },
      h('p', { id: 'history-stale-queue-count', role: 'status' }),
      h('div', { class: 'actions' },
        h('button', { id: 'history-stale-next', type: 'button', class: 'btn btn-secondary btn-sm', dataset: { i18n: 'work.staleNext' } }),
        h('button', { id: 'history-stale-clear-search', type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, dataset: { i18n: 'work.staleClearSearch' } }),
        h('button', { id: 'history-stale-summary', type: 'button', class: 'btn btn-ghost btn-sm', dataset: { i18n: 'work.staleBackSummary' } }))),
    h('section', { class: 'history-progress', 'aria-live': 'polite' },
      h('p', { id: 'history-action-count', class: 'caption' }),
      h('div', { class: 'actions' }, h('button', { id: 'history-next-issue', type: 'button', class: 'btn btn-secondary btn-sm', disabled: true }, '下一個問題'), h('button', { id: 'history-next-report', type: 'button', class: 'btn btn-secondary btn-sm', disabled: true }, '下一份待處理'))),
    h('div', { id: 'history-workbench', class: 'workbench', 'data-mobile-view': 'list' },
      h('div', { class: 'workbench-columns' },
        h('aside', { class: 'workbench-list' },
          h('div', { class: 'workbench-filters' }, field('ws.adv.historySearch', 'history-search', input('history-search', 'search', { autocomplete: 'off' })), field('ws.adv.historyFilter', 'history-filter', historyFilter), h('div', { class: 'field' }, h('label', { for: 'history-reason', dataset: { i18n: 'work.reason' } }), historyReason)),
          h('div', { id: 'history-items', class: 'workbench-items' }),
          T('p', 'ws.adv.historyEmpty', { id: 'history-empty', class: 'caption', hidden: true })),
        h('section', { id: 'history-editor', class: 'workbench-editor' },
          h('button', { id: 'history-back', type: 'button', class: 'btn btn-ghost btn-sm workbench-back' }, icon('chev-left'), say(h('span'), 'ws.adv.backList')),
          T('div', 'ws.adv.historyPick', { id: 'history-detail' })))),
    h('div', { class: 'report-mapping-section', hidden: true }, h('div', { id: 'report-mappings' })),
    h('div', { id: 'source-issues' }))
  const day = select('session-day')
  day.append(say(h('option', { value: '' }), 'ws.adv.sessionDayPick'))
  for (const [value, text] of [['0', '星期日'], ['1', '星期一'], ['2', '星期二'], ['3', '星期三'], ['4', '星期四'], ['5', '星期五'], ['6', '星期六']]) day.append(h('option', { value }, text))
  const classes = h('section', { class: 'adv-pane', 'data-adv-pane': 'classes', id: 'identity-review', hidden: true },
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, label('ws.adv.classroomSearch', 'classroom-search'), input('classroom-search', 'search'), btn('more-classrooms', 'ws.adv.more', 'btn btn-ghost btn-sm', { hidden: true })),
      field('ws.adv.classroom', 'classroom', select('classroom')),
      h('div', { class: 'field' }, label('ws.adv.courseSearch', 'mapping-course-search'), input('mapping-course-search', 'search'), btn('more-mapping-courses', 'ws.adv.more', 'btn btn-ghost btn-sm', { hidden: true }), h('select', { id: 'course', hidden: true })),
      h('div', { class: 'field' }, label('ws.adv.session', 'class-session'), select('class-session'), btn('more-sessions', 'ws.adv.more', 'btn btn-ghost btn-sm', { hidden: true }))),
    h('fieldset', { id: 'new-session', class: 'card-lite', hidden: true },
      say(h('legend'), 'ws.adv.newSession'),
      h('div', { class: 'form-grid' },
        field('ws.adv.sessionName', 'session-name', input('session-name', 'text', { maxLength: 256 })),
        field('ws.adv.sessionStart', 'session-start', input('session-start', 'date')),
        field('ws.adv.sessionDay', 'session-day', day),
        field('ws.adv.sessionFrom', 'session-from', input('session-from', 'time')),
        field('ws.adv.sessionTo', 'session-to', input('session-to', 'time'))),
      T('p', 'ws.adv.sessionHint', { class: 'caption' })),
    h('fieldset', { id: 'new-course', hidden: true },
      h('legend', {}, '舊版課程資訊'),
      h('div', { class: 'form-grid' }, h('label', { for: 'course-source-id' }, '來源課程 ID'), h('input', { id: 'course-source-id', maxLength: 256 }), h('label', { for: 'course-subject' }, '科目'), h('input', { id: 'course-subject', maxLength: 256 }), h('label', { for: 'course-stage' }, '階段'), h('input', { id: 'course-stage', maxLength: 256 }))),
    h('div', { class: 'card-lite' },
      T('h3', 'ws.adv.memory'),
      h('div', { class: 'actions' }, btn('remember-destination', 'ws.adv.remember', 'btn btn-secondary btn-sm'), btn('reload-memories', 'ws.adv.reload', 'btn btn-secondary btn-sm', {}, 'rotate'), btn('forget-session', 'ws.adv.forgetSession', 'btn btn-danger-ghost btn-sm'), btn('forget-classroom', 'ws.adv.forgetClassroom', 'btn btn-danger-ghost btn-sm'))))
  const fields = h('section', { class: 'adv-pane', 'data-adv-pane': 'fields', id: 'sync-settings', hidden: true },
    T('p', 'ws.adv.fieldsHelp', { class: 'caption' }),
    h('div', { id: 'sync-field-options', class: 'panel check-list' }),
    h('div', { class: 'actions' }, btn('save-sync-preferences', 'ws.adv.saveFields', 'btn btn-secondary btn-sm')),
    h('p', { id: 'sync-preferences-status', class: 'caption', role: 'status', 'aria-live': 'polite' }))
  const maint = h('section', { class: 'adv-pane', 'data-adv-pane': 'maint', hidden: true },
    h('div', { class: 'card-lite' }, T('h3', 'ws.adv.reread'), T('p', 'ws.adv.rereadHelp', { class: 'caption' }), h('div', {}, btn('reread-source', 'ws.adv.reread', 'btn btn-secondary btn-sm', {}, 'download'))),
    h('div', { class: 'card-lite' }, T('h3', 'ws.adv.recheck'), T('p', 'ws.adv.recheckHelp', { class: 'caption' }), h('div', {}, btn('check-history', 'ws.adv.recheck', 'btn btn-secondary btn-sm', {}, 'rotate'))))
  return [
    h('div', { class: 'scrim', id: 'advanced-scrim', hidden: true }),
    h('aside', { id: 'advanced-drawer', class: 'drawer drawer-wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'advanced-title', hidden: true },
      h('div', { class: 'drawer-head' },
        iconBtn('back', 'advanced', 'chev-left'),
        T('h2', 'ws.adv.title', { id: 'advanced-title' }),
        iconBtn('close', 'advanced', 'x')),
      tabs,
      h('div', { class: 'drawer-body' }, students, reports, classes, fields, maint),
      h('div', { class: 'drawer-foot' }, btn('advanced-apply', 'ws.adv.apply', 'btn btn-primary')))]
}

function confirmStep() {
  const stats = h('div', { class: 'summary', id: 'confirm-summary' },
    h('span', { class: 'stat' }, h('b', { id: 'stat-source' }, '0'), say(h('span'), 'ws.statSource')),
    h('span', { class: 'stat' }, h('b', { id: 'stat-auto' }, '0'), say(h('span'), 'ws.statAuto')),
    h('span', { class: 'stat stat-warn' }, h('b', { id: 'stat-decide' }, '0'), say(h('span'), 'ws.statDecide')),
    h('span', { class: 'spacer' }),
    btn('open-advanced', 'ws.openAdvanced', 'btn btn-secondary btn-sm', {}, 'sliders'))
  return h('section', { id: 'mapping', class: 'step-body', hidden: true },
    h('div', { class: 'ws-body', id: 'confirm-body' },
    h('div', { class: 'ws-col' },
    stats,
    h('section', { class: 'panel', id: 'auto-panel' }),
    h('section', { class: 'panel', id: 'exceptions', 'aria-labelledby': 'exceptions-title' }),
    h('section', { id: 'history-issues', class: 'panel', hidden: true }),
    h('div', { class: 'actionbar' },
      h('button', { id: 'back-to-read', type: 'button', class: 'btn btn-secondary' }, icon('chev-left'), say(h('span'), 'ws.back')),
      h('span', { id: 'review-action-summary', class: 'status', role: 'status', 'aria-live': 'polite' }),
      h('span', { class: 'spacer' }),
      h('button', { id: 'sync', type: 'button', class: 'btn btn-primary', 'aria-describedby': 'review-action-summary' }, icon('refresh'), say(h('span', { id: 'sync-label' }), 'ws.sync')))),
    h('div', { class: 'scrim scrim-narrow', id: 'detail-scrim', hidden: true }),
    h('aside', { id: 'detail-drawer', class: 'drawer', role: 'dialog', 'aria-labelledby': 'detail-title', hidden: true },
      h('div', { class: 'drawer-head' },
        iconBtn('back', 'detail', 'chev-left'),
        h('h2', { id: 'detail-title' }),
        iconBtn('close', 'detail', 'x')),
      h('div', { class: 'drawer-body', id: 'detail-body' }),
      h('div', { class: 'drawer-foot' }, btn('detail-done', 'ws.detail.done', 'btn btn-secondary')))),
    ...advancedDrawer())
}

function interruptStep() {
  return h('section', { id: 'preview-section', class: 'step-body', hidden: true },
    h('section', { class: 'interrupt', role: 'alert' },
      h('div', { class: 'interrupt-head' }, icon('alert', 'ic-xl'),
        h('div', {}, T('h2', 'ws.interruptTitle', { id: 'interrupt-title' }), T('p', 'ws.interruptHelp', { id: 'interrupt-help' }), h('p', { id: 'counts', class: 'caption' }))),
      h('div', { id: 'diff-list', class: 'diff-list' }),
      h('p', { class: 'caption interrupt-hint', dataset: { i18n: 'work.conflictHelp' } })),
    h('div', { class: 'actionbar' },
      h('button', { id: 'back-to-review', type: 'button', class: 'btn btn-secondary' }, icon('chev-left'), say(h('span'), 'ws.backConfirm')),
      h('span', { class: 'spacer' }),
      btn('repreview', 'ws.refreshDiff', 'btn btn-secondary', {}, 'rotate'),
      h('button', { id: 'apply', type: 'button', class: 'btn btn-primary' }, icon('refresh'), say(h('span', { id: 'apply-label' }), 'ws.continueSync'))))
}

function doneStep() {
  const view = h('a', { id: 'view-in-edulog', class: 'btn btn-primary', target: '_blank', rel: 'noopener noreferrer', hidden: true }, icon('external'), say(h('span'), 'ws.viewInEdulog'))
  return h('section', { id: 'import-progress', class: 'step-body', hidden: true },
    h('div', { class: 'result-head' },
      h('span', { id: 'done-icon', class: 'done-icon', hidden: true }, icon('check-circle', 'ic-xl')),
      T('h2', 'ws.progressTitle', { id: 'progress-heading' }),
      h('span', { id: 'done-sub', class: 'caption' })),
    h('section', { class: 'panel progress-panel', id: 'progress-panel' },
      h('div', { class: 'progress-body' }, h('progress', { id: 'progress', value: 0, max: 1 }), h('p', { id: 'progress-label', class: 'caption' }), T('p', 'ws.progressHelp', { class: 'caption' }))),
    h('div', { id: 'done-tiles', class: 'tiles' }),
    h('section', { id: 'skipped-panel', class: 'panel', hidden: true }),
    h('details', { class: 'panel outcome-details', id: 'outcome-details' },
      h('summary', {}, say(h('span'), 'ws.outcomeDetails'), icon('chev-down', 'chev')),
      h('div', { id: 'import-outcome', class: 'outcome', 'aria-live': 'polite', hidden: true })),
    h('div', { class: 'actionbar' },
      btn('pause', 'ws.pause'), btn('resume', 'ws.resumeSync', 'btn btn-secondary', { hidden: true }), btn('cancel-work', 'ws.cancelWork', 'btn btn-danger-ghost'),
      btn('import-other', 'ws.importOther', 'btn btn-secondary', { hidden: true }),
      h('span', { class: 'spacer' }),
      btn('return-source-import', 'ws.returnSource', 'btn btn-ghost'),
      view))
}

function workView() {
  const search = input('work-search', 'search', { autocomplete: 'off' }); say(search, 'ws.log.search', {}, 'placeholder'); say(search, 'ws.log.search', {}, 'aria-label')
  const classes = select('work-class-filter'); say(classes, 'ws.log.class', {}, 'aria-label')
  return h('section', { id: 'work-view', hidden: true },
    h('div', { class: 'ws-body', id: 'work-body' },
      h('div', { class: 'ws-col' },
        h('section', { class: 'panel' },
          h('div', { class: 'filters' },
            h('div', { class: 'search' }, icon('search'), search),
            classes,
            btn('refresh-work', 'ws.log.refresh', 'btn btn-ghost btn-sm', {}, 'rotate'),
            btn('archive-completed', 'ws.log.archiveDone', 'btn btn-ghost btn-sm')),
          h('p', { id: 'work-count', class: 'caption work-count', role: 'status', 'aria-live': 'polite' }),
          h('div', { id: 'work-errors' }),
          h('div', { id: 'work-list' }))),
      h('div', { class: 'scrim scrim-narrow', id: 'work-scrim', hidden: true }),
      h('aside', { id: 'work-detail', class: 'drawer', role: 'dialog', 'aria-labelledby': 'work-detail-title', hidden: true, 'aria-live': 'polite' })))
}

/** Build the page; `root` is the <body>. */
export function renderShell(root = document.body) {
  root.replaceChildren(
    T('a', 'ws.skip-to-content', { class: 'skip', href: '#main' }),
    h('div', { class: 'ws' },
      header(),
      tabs(),
      h('main', { id: 'main', tabindex: '-1' },
        operationStatus(),
        h('div', { id: 'notice', role: 'status', 'aria-live': 'polite' }),
        h('details', { id: 'diagnostics', class: 'diagnostics', hidden: true }, say(h('summary'), 'ws.diagnostics'), h('pre', { id: 'diagnostic' })),
        h('section', { id: 'connect', class: 'panel connect', hidden: true },
          h('div', { class: 'panel-head' }, T('h2', 'ws.connectTitle', { id: 'connect-title' }), T('p', 'ws.connectHelp', { id: 'connect-detail' })),
          h('div', { class: 'actions panel-pad' }, btn('open-connection', 'ws.connectOpen', 'btn btn-primary'), btn('reconnect', 'ws.connectRetry'))),
        h('div', { id: 'workspace', hidden: true },
          h('section', { id: 'import-view' },
            h('div', { class: 'task-line' },
              stepper(),
              h('span', { class: 'spacer' }),
              h('p', { class: 'task-meta caption' }, h('span', { id: 'task-title', 'data-source-raw': '' }), h('span', { id: 'task-status' }), h('span', { id: 'draft-status', role: 'status', 'aria-live': 'polite' }))),
            h('section', { id: 'continue-work', class: 'panel continuation', hidden: true },
              h('div', { class: 'panel-head' }, icon('history', 'ic-lg'), T('p', 'ws.resumeHelp', { id: 'continue-work-copy' })),
              h('div', { class: 'actions panel-pad' }, btn('resume-source-work', 'ws.resume', 'btn btn-primary', {}, 'play'), btn('start-new-work', 'ws.startNew'))),
            readStep(),
            confirmStep(),
            interruptStep(),
            doneStep()),
          workView()))))
}
