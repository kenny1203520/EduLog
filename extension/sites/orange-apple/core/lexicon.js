// Provider vocabulary: routes, structural selectors, status wording and page probes.
// When the provider changes its markup or wording, this is the first file to update.
(() => {
  const routes = Object.freeze([
    { kind: 'hours', title: '我的鐘點', pattern: /^\/my\/hour\/?$/ },
    { kind: 'profile', title: '個人資料', pattern: /^\/my\/?$/ },
    { kind: 'profile-edit', title: '編輯個人資料', pattern: /^\/my\/\d+\/edit\/?$/ },
    { kind: 'overview', title: '教師總覽', pattern: /^\/$/ },
    { kind: 'classes', title: '班級列表', pattern: /^\/courses\/dt\/?$/ },
    { kind: 'calendar', title: '課程行事曆', pattern: /^\/calendar$/ },
    { kind: 'unfilled', title: '未填寫紀錄', pattern: /^\/admissions\/month_unfilled_report$/ },
    { kind: 'unfilled-current', title: '補填課堂紀錄', pattern: /^\/admissions\/unfilled_report$/ },
    { kind: 'report-editor', title: '課堂紀錄編輯', pattern: /^\/dt_admissions\/\d+\/reports\/\d+\/edit\/?$/ },
    { kind: 'history', title: '學生學習紀錄', pattern: /^\/dt_admissions\/\d+\/?$/ },
    { kind: 'class', title: '班級工作區', pattern: /^\/courses\/dt\/\d+\/?$/ },
    { kind: 'renewals', title: '剩餘課堂', pattern: /^\/dt_admissions\/?$/ },
    { kind: 'sign-in', title: '登入', pattern: /^\/employees\/sign_in\/?$/ },
    { kind: 'password', title: '重設密碼', pattern: /^\/employees\/password(?:\/new|\/edit)?\/?$/ },
    { kind: 'reports', title: '課次報告', pattern: /^\/courses\/dt\/\d+\/lesson_reports\/?$/ },
  ])
  const selectors = Object.freeze({
    content: '#page-body > .content',
    sidebar: '#page-body > .sidebar',
    studentsTable: '#students-table',
    studentPicker: '#student_id-selectized',
    rosterLegend: '.color-labels',
    laptopFrame: 'turbo-frame[id^="laptop_"]',
    reportsTable: '#reports',
    reportModal: '#lesson-report-modal',
    remoteModal: '#remote_modal',
    attendanceAction: 'a[href*="attendance_status"]',
    sidebarLinks: '#page-body > .sidebar a[href]',
    // Session cells mark state with Font Awesome icons (<i> server-side, <svg> after
    // the provider's script runs) wrapped in a span coloured text-success/danger/secondary.
    attendanceIcon: '.fa-user',
    // Order in the cell: attendance, completion, internal record, learning performance.
    completionIcon: '.fa-pencil',
    internalIcon: '.fa-circle-question, .fa-question-circle',
    performanceIcon: '.fa-comment-dots, .fa-commenting',
    recordLink: 'a[href*="/reports/"][href$="/edit"]',
    admissionId: '[data-admission-id]',
    noteLink: 'a.admission-comment',
    lastStage: '[data-bs-title="最後上課階段"]',
    enableLesson: '.enable-ks-lesson-btn',
    // The "請先點名…" alert with "顯示本週上課 / 顯示全部"; the filter chips replace it.
    reportAlert: '.alert',
    reportAlertToggle: '.reports_show',
    // "本週快速點名": one report_ids[] checkbox per this-week report, saved by type=0/1 buttons.
    quickAttendanceForm: 'form[action$="/update_attendance"]',
    quickAttendanceBox: 'input[type=checkbox][name="report_ids[]"]',
    quickAttendanceSubmit: 'button[name="type"]',
    calendarDayPane: '.tab-pane[id*="-weekday-"]',
    // 「剩餘課堂」: the renewal table, its status badge and the provider's (unbound) renewal menu.
    renewTable: '#dt-admissions table',
    renewStatus: 'span.renew-status',
    renewAction: 'a.js-change-admission-renew-status[data-id][data-renew-status]',
    renewFilter: 'form[action$="/dt_admissions"][method="get"]',
    // Devise sign-in and password pages: found by id, not wording, in every site language.
    signInForm: 'form#new_employee',
    passwordForm: 'form[action$="/employees/password"]',
  })
  // Student learning-account modal (/students/:id/accounts, opened in remote_modal).
  const accounts = Object.freeze({
    modal: '#accounts-modal',
    siteField: 'input[name="student_account[site]"]',
    usernameField: 'input[name="student_account[username]"]',
    passwordField: 'input[name="student_account[password]"]',
    addButton: 'button[onclick*="remove_hidden"]',
    sites: Object.freeze({ koding_school: '橘子蘋果學苑', app_inventor: 'APP', roblox: 'Roblox', minecraft: '麥塊', anydesk: 'AnyDesk', exam: '測驗平台' }),
    usernameLabel: Object.freeze({ exam: '網址', anydesk: '帳號' }),
    // The provider's email pattern lost its backslashes (^w+…), so real addresses fail.
    brokenEmailPattern: /^\^w\+/,
  })
  // Teacher sidebar: class switcher, menu, search, profile, logout and language.
  const navigation = Object.freeze({
    sidebar: '#page-body > .sidebar',
    classLinks: '.teach-menu a[href]',
    classSwitcher: '.btn-group',
    nav: '#nav-teacher',
    menuLinks: '#main-menu .navbar-nav a[href]',
    moduleGroups: '#main-menu .navbar-nav li.dropdown, #main-menu .navbar-nav li.nav-item.dropdown',
    search: '#search_students',
    profile: 'a[href="/my"]',
    logout: 'a[data-method="delete"]',
    locales: '.locale-selector a[href]',
    // "樹林_非凡文理_201教室（菁英） - 週六 第 1 時段 (10:00 ~ 12:00)"
    weekdays: Object.freeze(['週日', '週一', '週二', '週三', '週四', '週五', '週六']),
    // Menu links EduLog names itself (translated at display), so they follow EduLog's language
    // instead of whatever the provider translated. Other links keep the provider's text.
    labels: Object.freeze({ '/': '總覽', '/calendar': '課程行事曆', '/admissions/month_unfilled_report': '月未填寫列表', '/admissions/unfilled_report': '補填課堂紀錄', '/courses/dt': '雙師班', '/my/hour': '我的鐘點', '/dt_admissions': '剩餘課堂' }),
    groupLabels: Object.freeze(['師資模組', '人資模組']),
  })
  // Same-origin pages the overview to-do view may read. Read-only, never submitted.
  const sources = Object.freeze({
    unfilledCurrent: '/admissions/unfilled_report',
    unfilledMonth: '/admissions/month_unfilled_report',
    calendar: '/calendar',
    hours: '/my/hour',
    classReports: id => `/courses/dt/${id}/lesson_reports`,
  })
  const paths = Object.freeze({
    classPage: /^\/courses\/dt\/\d+\/?$/,
    enrollment: /^\/dt_admissions\/(\d+)\/?$/,
    reportEditor: /^\/dt_admissions\/(\d+)\/reports\/(\d+)\/edit\/?$/,
  })
  // The provider shows zh-TW, zh-CN or English (its locale switch), and translates only some
  // pages. Readers compare zh-TW terms; these map the other wordings back to them. Each entry is
  // [zh-TW, ...zh-CN and English forms seen on the site]. Add only wording confirmed from pages.
  const TERMS = [
    // Class page: header, roster, lesson records
    ['節次資訊', '节次信息', 'Stage Info'], ['總覽', '总览', 'Overview'], ['課堂記錄', '课堂记录', 'Lesson Records'], ['教室', 'Classroom'], ['時段', '时段', 'Time Slot'],
    ['上課 / 報名 / 上限', '上课 / 报名 / 上限', 'Classes / Enrolled / Capacity'], ['本週試聽學生', '本周试听学生', "This Week's Trial Students"], ['已試聽學生', '已试听学生', 'Auditioned Students'],
    ['調課學生', '调课学生', 'Transferred Students'], ['進度較慢學生', '进度较慢学生', 'Slow Progress Students'], ['姓名', 'Name'], ['年級', '年级', 'Grade'], ['課程', '课程', 'Course'],
    ['訂單狀態', '订单状态', 'Order Status'], ['報名時間', '报名时间', 'Enrolled At'], ['剩餘堂數', '剩余堂数', 'Remaining'], ['可上堂數', '可上堂数', 'Available'], ['已用補課數', '已用补课数', 'Used Makeup'],
    ['可補課數', '可补课数', 'Available Makeup'], ['操作', 'Actions'], ['預計開課日期', '预计开课日期', 'Expected start date'], ['學生', '学生', 'Student', 'Students'], ['出席統計', '出席统计', 'Attendance'],
    ['上週', '上周', 'Last Week'], ['本週', '本周', 'This Week'], ['下週', '下周', 'Next Week'], ['查看完整紀錄', '查看完整记录', 'View Full Record'], ['設定', '设定', 'Settings'], ['總評', '总评', 'Overall Comment'],
    ['專案檢查', '项目检查', '专案检查', 'Project Check', 'Check Project'], ['記錄', '记录', 'Record'], ['此週非本班學生', '此周非本班学生', 'Not in class this week'], ['已完課', '已完课', 'Completed'],
    ['暫停課程', '暂停课程', 'Suspended'], ['休假日'], ['停課', '停课'], ['課程取消', '课程取消'], ['待確認', '待确认'], ['顯示本週上課', '显示本周上课', 'Show This Week'], ['顯示全部', '显示全部', 'Show All'],
    ['搜尋學生姓名', '搜索学生姓名', 'Search student name'],
    // Renewal list (only zh-TW wording seen; the site does not translate this table)
    ['聯絡人'], ['剩餘次數'], ['續班與否'], ['下階段'], ['建立人'],
    // Calendar
    ['前一週', '前一周', 'Previous Week'], ['下一週', '下一周', 'Next Week'], ['請選擇區域', '请选择区域', 'Please select a region'], ['選擇欲前往的日期', '选择欲前往的日期', 'Select a date'],
    // Enrollment history
    ['梯次/節次', '梯次/节次', 'Stage/Section'], ['課程名稱', '课程名称', 'Course'], ['總堂數', '总堂数', 'Total Lessons'], ['可補課次數', '可补课次数', 'Makeup Lessons'], ['堂次', 'Lesson'], ['日期', 'Date'],
    ['啟用進度', '启用进度', 'Enable Progress'], ['課程進度', '课程进度', 'Course Progress', 'Progress'], ['出席狀況', '出席状况', 'Attendance'], ['學習評估', '学习评估', 'Learning Eval'], ['出席試聽', '出席试听', 'AttendedTrial'],
    ['最新課程階段', '最新课程阶段', 'Latest Stage'], ['完整完成', 'Completed in full'], ['評語', '评语', 'Feedback'], ['聯絡欄', '联络栏', 'Contact'], ['紀錄', '记录', 'Notes'], ['能跟上進度', '能跟上进度', 'Able to keep up with the lesson'],
    ['出席', 'Attended'], ['進度細項', '进度细项', 'Progress Detail'], ['尚未完成', 'Not completed'], ['設為不出席', '设为不出席', 'Mark Absent'], ['補課', '补课', 'Make-up'], ['已調課', '已调课', 'Rescheduled'], ['假期', 'Holiday'],
    ['目前進度', '目前进度', 'Progress'], ['實際出席', '实际出席', 'Attended'], ['不出席', 'Absent'],
    // Report editor
    ['不出席原因', 'Absence Reason'], ['專案進度', '专案进度', 'Project Progress'], ['學習課程', '学习课程', 'Learning Course'], ['完成狀況', '完成状况', 'Completion Status'], ['章節進度', '章节进度', 'Section Progress'],
    ['課程參與', '课程参与', 'Course Participation'], ['課堂秩序', 'Class Order'], ['學習表現', '学习表现', 'Learning Performance'], ['跟不上進度 (太難)', '跟不上进度（太难）', 'Unable to keep up (too difficult)'],
    ['跟不上進度 (分心)', '跟不上进度（分心）', 'Unable to keep up (distracted)'], ['課堂紀錄', '课堂记录', 'Lesson Record', 'Lesson Report'],
    // Unfilled lists (/admissions/unfilled_report; the month list stays zh-TW in every locale)
    ['學習紀錄節次', '学习记录节次', 'Record Stage'], ['目前節次', '目前节次', 'Current Stage'],
  ]
  const fold = value => {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ')
    return (text.endsWith('：') || text.endsWith(':') ? text.slice(0, -1).trim() : text).toLowerCase()
  }
  const forms = new Map(), canonical = new Map()
  for (const [zh, ...others] of TERMS) {
    forms.set(zh, [...new Set([...(forms.get(zh) || [zh]), ...others])])
    for (const form of [zh, ...others]) if (!canonical.has(fold(form))) canonical.set(fold(form), zh)
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Every wording of a zh-TW term, e.g. for building selectors from provider placeholders.
  const termForms = term => forms.get(term) || [term]
  // Whether a label (trailing colon ignored) is any wording of one of these zh-TW terms.
  const isTerm = (value, ...terms) => terms.some(term => termForms(term).some(form => fold(form) === fold(value)))
  // A label in zh-TW wording when it is a known term; other text is returned unchanged.
  const canonLabel = value => canonical.get(fold(value)) || value
  // The provider's active locale, from its language switch; zh-TW when it cannot tell.
  function siteLocale(doc = globalThis.document) {
    const href = doc?.querySelector?.('.locale-selector a.btn-primary')?.getAttribute('href') || ''
    const code = /[?&]locale=([\w-]+)/.exec(href)?.[1] || doc?.documentElement?.lang || ''
    return /^en/i.test(code) ? 'en' : /^zh-(?:CN|Hans)/i.test(code) ? 'zh-CN' : 'zh-TW'
  }
  // Session cells, week headers and class names carry short status phrases; these become
  // zh-TW so the patterns in `text` and `navigation` read every locale. Course and student
  // names never pass through here.
  const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const PHRASES = ['此週非本班學生', '暫停課程', '已完課', '停課', '課程取消', '待確認', '上週', '本週', '下週', '記錄']
    .flatMap(zh => termForms(zh).filter(form => form !== zh).map(form => [form, zh]))
    .sort((a, b) => b[0].length - a[0].length)
    .map(([form, zh]) => [new RegExp(/^[\x20-\x7e]+$/.test(form) ? `(?<![A-Za-z])${escape(form)}(?![A-Za-z])` : escape(form), 'g'), zh])
  function canonStatus(raw, doc) {
    let out = String(raw ?? '')
    if (siteLocale(doc) === 'zh-TW') return out
    out = out.replace(/(?<![A-Za-z])Week\s*(\d+)\s*\(/g, '第 $1 週(').replace(/第\s*(\d+)\s*周/g, '第 $1 週')
      .replace(/(?<![A-Za-z])Enabled\s+(L\d*)/g, '已啟用 $1').replace(/已启用/g, '已啟用').replace(/(?<![A-Za-z])Enable\s+L/g, '啟用 L').replace(/启用 L/g, '啟用 L')
    for (const [pattern, zh] of PHRASES) out = out.replace(pattern, zh)
    return out
  }
  // English week headers read "Last Week (18/10)": day first. Readers expect month/day.
  function canonWeekLabel(label, doc) {
    const out = canonStatus(label, doc)
    return siteLocale(doc) === 'en' ? out.replace(/(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/g, '$2/$1') : out
  }
  // "… - Sunday Period 1 (10:00 ~ 12:00)" / "… - 周日 第 1 时段 (…)" → the zh-TW form.
  function canonClassName(name) {
    return String(name ?? '').replace(new RegExp(`(?<![A-Za-z])(${WEEKDAYS_EN.join('|')})\\s+Period\\s+(\\d+)`), (_, day, slot) => `${navigation.weekdays[WEEKDAYS_EN.indexOf(day)]} 第 ${slot} 時段`)
      .replace(/周([一二三四五六日])/g, '週$1').replace(/时段/g, '時段')
  }
  // A pattern matching any wording of these terms. No word boundaries: row text runs cells
  // together ("…AttendanceLearning Eval…"); English forms still match case-sensitively.
  const anyTerm = (...terms) => new RegExp(terms.flatMap(termForms).map(escape).join('|'))
  // A whole header cell that is exactly one wording of these terms. (?![\s\S]) ends the match
  // instead of a dollar sign, which the startup harness would read as a replace() pattern.
  const exactTerm = (...terms) => new RegExp(`^(?:${terms.flatMap(termForms).map(escape).join('|')})(?![\\s\\S])`)
  // "学生: 名字" / "Student: 名字": the value after the leading label when that label is a
  // wording of one of these terms, otherwise null. Several terms share English forms
  // ("Course"), so callers name the terms they expect instead of guessing one.
  function leadTerm(value, ...terms) {
    const text = String(value ?? '')
    const fullWidthColon = text.indexOf('：'), asciiColon = text.indexOf(':')
    const colon = fullWidthColon < 0 ? asciiColon : asciiColon < 0 ? fullWidthColon : Math.min(fullWidthColon, asciiColon)
    if (colon < 0) return null
    const label = text.slice(0, colon).trim()
    return isTerm(label, ...terms) ? text.slice(colon + 1).trim() : null
  }
  // "評語：" in any wording: a label followed by a colon.
  const labelPattern = (...terms) => new RegExp(terms.flatMap(termForms).map(form => `${escape(form)}\\s*[：:]`).join('|'))
  const locale = Object.freeze({ siteLocale, termForms, isTerm, canonLabel, leadTerm, canonStatus, canonWeekLabel, canonClassName, pattern: anyTerm, labelPattern })
  const text = Object.freeze({
    accessDenied: /沒有存取權限|無權限|Access denied/i,
    nameHeader: anyTerm('姓名'),
    studentCoreColumn: anyTerm('姓名', '年級', '課程', '操作'),
    gradeHeader: anyTerm('年級'),
    courseHeader: anyTerm('課程'),
    signupHeader: anyTerm('報名時間'),
    makeupHeader: /補課|补课|Makeup/,
    weekLabel: /上週|本週|下週/,
    currentWeek: /本週/,
    otherSession: /此週非本班學生/,
    courseStatus: /休假日|停課|課程取消|此週非本班學生|暫停課程|已完課/,
    statusKnown: /休假日|停課|課程取消|此週非本班學生|暫停課程|已完課|已啟用|待確認/,
    attendancePending: /待確認出席|尚未確認出席|未登記出席|出席待確認/,
    attendance: /出席|缺席|未出席/,
    reportPending: /未填寫|待填寫|待補填/,
    reportDone: /已填寫課堂紀錄|課堂紀錄已完成|報告已完成/,
    scheduledLesson: /第\s*\d+\s*週\s*\((L\d+)\)/i,
    lessonCode: /\bL\d+\b/i,
    enabledLesson: /已啟用\s*(L\d+)/i,
    enabled: /已啟用/,
    absent: /缺席|未出席/,
    unfilledStudent: exactTerm('學生'),
    unfilledRecord: exactTerm('課堂紀錄'),
    unfilledSlot: exactTerm('學習紀錄節次'),
    // 「我的鐘點」 is a pay sheet: dates are 2026/10/17 (or a month, 2026/10 for 責任獎金), the
    // last column is an NT$ amount, and each table is followed by the provider's own total.
    hourDate: /\d{4}\/\d{1,2}\/\d{1,2}/g,
    hourMonth: /\d{4}\/\d{1,2}(?![\d/])/,
    hourTotal: /NT\$\s*([\d,]+(?:\.\d+)?)/,
    isoDate: /\d{4}-\d{2}-\d{2}/,
    calendarDay: /(\d{1,2})\/(\d{1,2})/,
    nextWeek: /下週/,
    courseExpired: /課程已在\s*[\d-]+\s*到期/,
    remainingLessons: anyTerm('剩餘堂數'),
    plannedStart: anyTerm('預計開課日期'),
  })
  // Structural facts a page needs before it may be enhanced. A missing probe means
  // the provider markup changed: the page stays original and the toolbar says so.
  const probes = Object.freeze({
    '*': [selectors.content],
    reports: [selectors.reportsTable],
    renewals: [selectors.renewTable],
    'sign-in': [selectors.signInForm],
  })
  globalThis.edulogSiteLexicon = Object.freeze({ routes, selectors, paths, sources, accounts, navigation, text, probes, locale })
})()
