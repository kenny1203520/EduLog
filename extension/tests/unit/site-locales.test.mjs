import test from 'node:test'
import { siteFiles } from '../site-files.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from '../../../app/node_modules/jsdom/lib/api.js'

// The provider can show zh-CN or English and translates only some pages. These tests take the
// de-identified zh-TW fixtures, rewrite them with the wording the site actually shows in the other
// two languages (from saved zh-CN / English pages, 2026-10), and require the same facts from all
// three. zh-TW is the reference because it is the same snapshot.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const WORDING = {
  'zh-CN': {
    '我的班級梯次': '我的班级梯次', '課程行事曆': '课程行事历', '月未填寫列表': '月未填写列表', '總覽': '总览', '課堂記錄': '课堂记录', '學生': '学生', '姓名': '姓名', '年級': '年级', '課程': '课程',
    '訂單狀態': '订单状态', '報名時間': '报名时间', '剩餘堂數 /': '剩余堂数 /', '可上堂數': '可上堂数', '已用補課數 /': '已用补课数 /', '可補課數': '可补课数', '操作': '操作', '預計開課日期': '预计开课日期',
    '出席統計': '出席统计', '上週': '上周', '本週': '本周', '下週': '下周', '查看完整紀錄': '查看完整记录', '專案檢查': '项目检查', '此週非本班學生': '此周非本班学生', '暫停課程': '暂停课程',
    '顯示本週上課': '显示本周上课', '顯示全部': '显示全部', '本週試聽學生': '本周试听学生', '已試聽學生': '已试听学生', '調課學生': '调课学生', '進度較慢學生': '进度较慢学生', '搜尋': '搜索',
    '搜尋學生姓名': '搜索学生姓名', '請先點名,點名之後才可以啟用課程,如設定為不出席則無法啟用課程': '请先点名，点名之后才可以启用课程，如设定为不出席则无法启用课程',
    '堂次': '堂次', '日期': '日期', '啟用進度': '启用进度', '課程進度': '课程进度', '出席狀況': '出席状况', '學習評估': '学习评估', '寄送時未填寫': '发送时未填写', '設為不出席': '设为不出席',
    '目前進度:2 實際出席:2 不出席:0 可補課次數:2': '目前进度:2 实际出席:2 不出席:0 可补课次数:2',
    '不出席原因': '不出席原因', '學習課程': '学习课程', '完成狀況': '完成状况', '章節進度': '章节进度', '專案進度': '专案进度', '課程參與': '课程参与', '學習表現': '学习表现', '聯絡欄': '联络栏',
    '完整完成': '完整完成', '尚未完成': '尚未完成', '能跟上進度': '能跟上进度', '跟不上進度 (太難)': '跟不上进度（太难）', '跟不上進度 (分心)': '跟不上进度（分心）', '記錄(給內部看的)': '记录(给内部看的)',
  },
  en: {
    '我的班級梯次': 'My Classes', '課程行事曆': 'Course Calendar', '月未填寫列表': 'Monthly Unfilled List', '總覽': 'Overview', '課堂記錄': 'Lesson Records', '學生': 'Student', '姓名': 'Name', '年級': 'Grade',
    '課程': 'Course', '訂單狀態': 'Order Status', '報名時間': 'Enrolled At', '剩餘堂數 /': 'Remaining /', '可上堂數': 'Available', '已用補課數 /': 'Used Makeup /', '可補課數': 'Available Makeup', '操作': 'Actions',
    '預計開課日期': 'Expected start date', '出席統計': 'Attendance', '上週': 'Last Week', '本週': 'This Week', '下週': 'Next Week', '查看完整紀錄': 'View Full Record', '專案檢查': 'Project Check',
    '此週非本班學生': 'Not in class this week', '暫停課程': 'Suspended', '顯示本週上課': 'Show This Week', '顯示全部': 'Show All', '本週試聽學生': "This Week's Trial Students", '已試聽學生': 'Auditioned Students',
    '調課學生': 'Transferred Students', '進度較慢學生': 'Slow Progress Students', '搜尋': 'Search', '搜尋學生姓名': 'Search student name',
    '請先點名,點名之後才可以啟用課程,如設定為不出席則無法啟用課程': 'Please take attendance first. You can enable the course after attendance is recorded. Students marked absent cannot have their course enabled.',
    '堂次': 'Lesson', '日期': 'Date', '啟用進度': 'Enable Progress', '課程進度': 'Course Progress', '出席狀況': 'Attendance', '學習評估': 'Learning Eval', '寄送時未填寫': 'Not Filled at Send', '出席': 'Attended',
    '設為不出席': 'Mark Absent', '目前進度:2 實際出席:2 不出席:0 可補課次數:2': 'Progress: 2 Attended: 2 Absent: 0 Makeup Lessons:2',
    '不出席': 'Absent', '不出席原因': 'Absence Reason', '學習課程': 'Learning Course', '完成狀況': 'Completion Status', '章節進度': 'Section Progress', '專案進度': 'Project Progress', '課程參與': 'Course Participation',
    '課堂秩序': 'Class Order', '學習表現': 'Learning Performance', '聯絡欄': 'Contact', '完整完成': 'Completed in full', '尚未完成': 'Not completed', '能跟上進度': 'Able to keep up with the lesson',
    '跟不上進度 (太難)': 'Unable to keep up (too difficult)', '跟不上進度 (分心)': 'Unable to keep up (distracted)', '記錄(給內部看的)': 'Notes (Internal)', '至': 'to',
  },
}
// "Label：value" lines on the enrollment page.
const LEADS = {
  'zh-CN': { '學生': '学生', '梯次/節次': '梯次/节次', '課程名稱': '课程名称', '總堂數': '总堂数', '可補課次數': '可补课次数', '報名時間': '报名时间', '最新課程階段': '最新课程阶段', '評語': '评语', '聯絡欄': '联络栏', '紀錄': '记录' },
  en: { '學生': 'Student', '梯次/節次': 'Stage/Section', '課程名稱': 'Course', '總堂數': 'Total Lessons', '可補課次數': 'Makeup Lessons', '報名時間': 'Enrolled At', '最新課程階段': 'Latest Stage', '評語': 'Feedback', '聯絡欄': 'Contact', '紀錄': 'Notes' },
}
const EN_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ZH_DAYS = ['日', '一', '二', '三', '四', '五', '六']
function localize(html, locale) {
  if (locale === 'zh-TW') return html
  const dom = new JSDOM(html), doc = dom.window.document
  const words = WORDING[locale], leads = LEADS[locale]
  const rewrite = value => {
    const core = value.trim()
    if (!core) return value
    let out = words[core] ?? core
    const lead = /^([^：:]+)([：:])([\s\S]*)$/.exec(out)
    if (lead && leads[lead[1]]) out = `${leads[lead[1]]}${lead[2]}${lead[3]}`
    out = out.replace(/週([日一二三四五六]) 第 (\d+) 時段/g, (_, day, slot) => locale === 'en' ? `${EN_DAYS[ZH_DAYS.indexOf(day)]} Period ${slot}` : `周${day} 第 ${slot} 时段`)
      .replace(/第 (\d+) 週\((L\d+)\)/g, (_, week, lesson) => locale === 'en' ? `Week ${week}(${lesson})` : `第 ${week} 周(${lesson})`)
      .replace(/已啟用 (L\d+)/g, locale === 'en' ? 'Enabled $1' : '已启用 $1').replace(/^啟用 (L\d*)$/, locale === 'en' ? 'Enable $1' : '启用 $1')
    if (locale === 'en') out = out.replace(/^\((\d{2})\/(\d{2})\)$/, '($2/$1)')
    return value.replace(core, out)
  }
  const walker = doc.createTreeWalker(doc.body, 4)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) node.textContent = rewrite(node.textContent)
  for (const el of doc.querySelectorAll('[placeholder],[title],[data-bs-title]')) for (const name of ['placeholder', 'title']) if (el.hasAttribute(name)) el.setAttribute(name, rewrite(el.getAttribute(name)))
  // The site's language switch marks the active locale.
  const switcher = doc.createElement('div'); switcher.className = 'locale-selector'
  for (const code of ['zh-TW', 'zh-CN', 'en']) { const a = doc.createElement('a'); a.href = `/locale?locale=${code}`; a.className = code === locale ? 'btn btn-primary' : 'btn'; switcher.append(a) }
  ;(doc.querySelector('#page-body > .sidebar') || doc.body).append(switcher)
  return dom.serialize()
}
const SCRIPTS = ['shared/source-date.js', 'shared/field-mappings.js', ...siteFiles('lexicon', 'model', 'todo', 'session-cards', 'attendance-export', 'quick-attendance', 'accounts', 'navigation', 'report-editor', 'roster', 'workflows', 'integration'), 'sites/orange-apple/core/adapter.js']
function load(fixture, url, locale) {
  const dom = new JSDOM(localize(read(`../fixtures/${fixture}`), locale), { url, runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  Object.defineProperty(w, 'crypto', { value: webcrypto }); w.TextEncoder = TextEncoder
  for (const file of SCRIPTS) w.eval(read(`../../${file}`))
  return w
}
const LOCALES = ['zh-TW', 'zh-CN', 'en']
// Evidence keeps the site's own wording; the facts must not depend on it.
const facts = value => JSON.parse(JSON.stringify(value, (key, v) => ['label', 'text', 'capturedAt', 'raw', 'dateRaw', 'value', 'options', 'sourceLearningStatusRaw'].includes(key) ? undefined : v))

test('the lexicon reads week headers, lesson cells and class names in every site language', () => {
  for (const locale of LOCALES) {
    const w = load('real-class.html', 'https://corp.orangeapple.co/courses/dt/101', locale), model = w.edulogSiteModel, site = w.edulogSiteLexicon.locale
    assert.equal(site.siteLocale(w.document), locale)
    const weeks = model.readWeekColumns(w.document.querySelectorAll('#reports tr:first-child th'))
    // Values come from the page's own window; compare them as plain data.
    assert.deepEqual([...weeks].map(week => week.label.replace(/\s+/g, '')), ['上週(10/10)', '本週(10/17)', '下週(10/24)'], locale)
    assert.equal(model.weekDate(weeks[1].label, new Date('2026-10-15T00:00:00Z')).toISOString(), '2026-10-16T16:00:00.000Z', locale)
    assert.deepEqual(JSON.parse(JSON.stringify(model.classSchedule(w.document.querySelector('.teach-menu a').textContent))), { weekday: 6, weekdayLabel: '週六', start: '10:00', end: '12:00', branch: '測試分校', room: '201教室' }, locale)
    assert.equal(model.classifySession(model.sessionText(w.document.querySelector('#reports tbody td:nth-child(5)'))).scheduledLesson !== undefined, true)
  }
  const w = load('real-class.html', 'https://corp.orangeapple.co/courses/dt/101', 'en'), site = w.edulogSiteLexicon.locale
  assert.equal(site.canonStatus('Week 10(L14) Enabled L15 Not in class this week Suspended'), '第 10 週(L14) 已啟用 L15 此週非本班學生 暫停課程')
  assert.equal(site.leadTerm('Course: 菁英_Python', '課程名稱'), '菁英_Python')
  assert.equal(site.leadTerm('Student: Course', '課程名稱'), null)
  assert.ok(site.isTerm('Attendance', '出席統計') && site.isTerm('Attendance', '出席狀況') && site.isTerm('出席统计：', '出席統計'))
})

test('the class workspace renders the same cards, chips and roster in every site language', () => {
  const summary = locale => {
    const w = load('real-class.html', 'https://corp.orangeapple.co/courses/dt/101', locale), doc = w.document
    w.edulogSiteAdapter.enhancePage(doc, {})
    return {
      chips: Object.fromEntries([...doc.querySelectorAll('[data-chip]')].map(button => [button.dataset.chip, button.querySelector('.edulog-chip-count')?.textContent])),
      cards: [...doc.querySelectorAll('.edulog-session-card')].map(card => `${card.querySelector('.edulog-row-name')?.textContent}:${card.dataset.group}`),
      roster: [...doc.querySelectorAll('.edulog-roster-card')].map(card => card.dataset.group),
      bars: [...doc.querySelectorAll('.edulog-roster-bar')].map(bar => bar.dataset.tone),
      weeks: doc.querySelectorAll('[data-week]').length,
    }
  }
  const reference = summary('zh-TW')
  assert.ok(reference.cards.length && reference.roster.length && reference.bars.length && reference.weeks >= 3, JSON.stringify(reference))
  for (const locale of ['zh-CN', 'en']) assert.deepEqual(summary(locale), reference, locale)
})

test('class import reads the same students, enrollments and dated reports in every site language', () => {
  const records = locale => facts(load('real-class.html', 'https://corp.orangeapple.co/courses/dt/101', locale).edulogSourceIntegration.extractClass(load('real-class.html', 'https://corp.orangeapple.co/courses/dt/101', locale).document, '/courses/dt/101').records)
  const reference = records('zh-TW')
  assert.ok(reference.some(record => record.kind === 'report' && record.date), 'zh-TW reports carry dates')
  for (const locale of ['zh-CN', 'en']) assert.deepEqual(records(locale), reference, locale)
})

test('enrollment history import reads the same teaching data in every site language', () => {
  const rows = locale => {
    const w = load('history.html', 'https://corp.orangeapple.co/dt_admissions/301', locale)
    return facts(w.edulogSourceIntegration.extractHistory(w.document, '301'))
  }
  const reference = rows('zh-TW')
  assert.ok(JSON.stringify(reference).includes('"content"'), 'zh-TW history has teaching content')
  for (const locale of ['zh-CN', 'en']) assert.deepEqual(rows(locale), reference, locale)
})

test('the report form reads the same fields in every site language, and prefill maps option codes', async () => {
  const form = async locale => {
    const w = load('real-report-editor.html', 'https://corp.orangeapple.co/dt_admissions/9001/reports/7001/edit', locale)
    const result = await w.edulogSourceIntegration.readForm(w.document)
    const mappings = w.edulogFieldMappings
    return JSON.parse(JSON.stringify({ fields: [...result.fields].map(field => [field.key, field.value, [...field.options].map(option => [option.value, mappings.scalar(field, option) ?? null])]) }))
  }
  const reference = await form('zh-TW')
  assert.ok(reference.fields.some(([key, , options]) => key === 'attendance_status' && options.some(([value, scalar]) => value === 'attended' && scalar === 'present')))
  for (const locale of ['zh-CN', 'en']) assert.deepEqual(await form(locale), reference, locale)
})
