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
    { kind: 'reports', title: '課次報告', pattern: /^\/courses\/dt\/\d+\/lesson_reports\/?$/ },
  ])
  const selectors = Object.freeze({
    content: '#page-body > .content',
    sidebar: '#page-body > .sidebar',
    studentsTable: '#students-table',
    studentPicker: '#student_id-selectized',
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
    calendarDayPane: '.tab-pane[id*="-weekday-"]',
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
  const text = Object.freeze({
    accessDenied: /沒有存取權限|無權限|Access denied/i,
    nameHeader: /姓名/,
    studentCoreColumn: /姓名|年級|課程|操作/,
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
    unfilledStudent: /^學生$/,
    unfilledRecord: /課堂紀錄/,
    unfilledSlot: /學習紀錄節次/,
    isoDate: /\d{4}-\d{2}-\d{2}/,
    calendarDay: /(\d{1,2})\/(\d{1,2})/,
    nextWeek: /下週/,
    courseExpired: /課程已在\s*[\d-]+\s*到期/,
    remainingLessons: /剩餘堂數/,
  })
  // Structural facts a page needs before it may be enhanced. A missing probe means
  // the provider markup changed: the page stays original and the toolbar says so.
  const probes = Object.freeze({
    '*': [selectors.content],
    reports: [selectors.reportsTable],
  })
  globalThis.edulogSiteLexicon = Object.freeze({ routes, selectors, paths, sources, accounts, text, probes })
})()
