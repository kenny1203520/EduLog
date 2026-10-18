import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { classEntries, exceptionModel, renderClassList, renderConfirmOverview, entries } from '../workspace/workspace-steps.js'

test('my classes merge open class tabs with classes synced before, current tab first', () => {
  const list = classEntries({
    currentTabId: 12,
    tabs: [{ id: 10, title: '初階程式 A 班', path: '/courses/dt/11' }, { id: 12, title: '機器人 B 班', path: '/courses/dt/12' }, { id: 20, title: '未填報告', path: '/admissions/unfilled_report' }],
    works: [{ type: 'import', status: 'complete', sourceClassId: '14', sourceTitle: '積木創客 D 班', updatedAt: 2000 }, { type: 'import', status: 'complete', sourceClassId: '11', updatedAt: 1000, snapshot: { records: [{ kind: 'enrollment' }, { kind: 'enrollment' }] } }, { type: 'import', status: 'collected', sourceClassId: '15' }, { type: 'prefill', sourceClassId: '16' }],
  })
  assert.deepEqual(list.map(item => item.classId), ['12', '11', '14', '15'])
  assert.equal(list[0].current, true)
  assert.equal(list[1].tabId, 10); assert.equal(list[1].lastSync, 1000); assert.equal(list[1].students, 2)
  assert.equal(list[2].tabId, null); assert.equal(list[2].path, '/courses/dt/14'); assert.equal(list[2].title, '積木創客 D 班')
  assert.equal(list[3].lastSync, 0)
})

test('confirm lists only exceptions, grouped by kind, and counts automatic matches', () => {
  const needs = (key, code, extra = {}) => ({ key, category: 'needs', reason: code, issues: [{ code }], record: { sourceStudentName: key, date: '2026-10-04', enrollment_source_id: '301', ...extra } })
  const model = exceptionModel({
    items: [needs('a', 'class'), needs('b', 'class-other'), needs('c', 'occurrence-mismatch'), needs('d', 'both-changed'), needs('e', 'date'), needs('f', 'enrollment', { enrollment_source_id: '302' }), needs('g', 'enrollment', { enrollment_source_id: '302' }),
      { key: 'h', category: 'bind' }, { key: 'i', category: 'history' }, { key: 'j', category: 'linked' }, { key: 'k', category: 'system-excluded', attendanceEvidence: true }, { key: 'l', category: 'unfilled' }, { key: 'm', category: 'skipped' }],
    enrollments: [{ kind: 'enrollment', source_id: '302', sourceStudentName: '周小澄' }],
  })
  assert.deepEqual(model.groups.map(group => [group.kind, group.items.map(item => item.key)]), [['class', ['a', 'b']], ['occurrence', ['c']], ['both', ['d']], ['student', ['enrollment:302']], ['other', ['e']]])
  assert.equal(model.total, 6)
  assert.equal(model.groups.find(group => group.kind === 'student').items[0].reports, 2)
  assert.deepEqual([model.auto.reports, model.auto.attendance], [3, 1])
})

test('class list and confirm overview render, pick and navigate in both languages', async () => {
  const dom = new JSDOM('<body><ul id="classes"></ul><div id="confirm"></div></body>', { runScripts: 'outside-only' }), w = dom.window
  w.eval(readFileSync(new URL('../shared/ui-core.js', import.meta.url), 'utf8')); await new Promise(resolve => setTimeout(resolve, 0))
  globalThis.edulogUi = w.edulogUi; w.edulogUi.register(entries); w.edulogUi.setLocale('zh-TW')
  try {
    const picked = []
    renderClassList(w.document.getElementById('classes'), [{ classId: '11', title: '初階程式 A 班', tabId: 10, current: true, lastSync: 0, students: 8 }, { classId: '12', title: '', tabId: null, current: false, lastSync: new Date(2026, 9, 11).getTime(), students: 0 }], { selected: '11', onPick: item => picked.push(item.classId) })
    const rows = [...w.document.querySelectorAll('#classes li')]
    assert.equal(rows[0].querySelector('input').checked, true); assert.match(rows[0].textContent, /目前分頁/); assert.match(rows[0].textContent, /8 位學生/)
    assert.match(rows[1].textContent, /原站班級 #12/); assert.match(rows[1].textContent, /上次同步 10\/11/)
    rows[1].querySelector('input').checked = true; rows[1].querySelector('input').dispatchEvent(new w.Event('change')); assert.deepEqual(picked, ['12'])
    const host = w.document.getElementById('confirm'), resolved = [], toggles = []
    w.Element.prototype.scrollIntoView = function () { this.dataset.scrolled = 'true' }
    const model = exceptionModel({ items: [{ key: 'a', category: 'needs', reason: '無法確認班級', issues: [{ code: 'class' }], record: { sourceStudentName: '陳小禾', date: '2026-10-04' } }, { key: 'b', category: 'needs', issues: [{ code: 'both-changed' }], record: { sourceStudentName: '吳小恩' } }, { key: 'c', category: 'bind', record: { sourceStudentName: '黃小宇' } }] })
    renderConfirmOverview(host, model, { className: '初階程式 A 班', handled: 1, autoOpen: true, onToggleAuto: open => toggles.push(open), onResolve: item => resolved.push(item.key), autoLabel: () => 'work.matched' })
    assert.equal(host.querySelector('h2').textContent, '確認 2 個例外')
    assert.match(host.textContent, /已處理 1 \/ 3/); assert.match(host.textContent, /已自動配對 1 筆（報告 1、出席 0）/)
    assert.deepEqual([...host.querySelectorAll('[data-group]')].map(group => group.dataset.group), ['class', 'both'])
    assert.match(host.querySelector('.auto-list').textContent, /黃小宇.*已配對/)
    host.querySelector('#confirm-next').click(); assert.equal(host.querySelector('[data-exception-key=a]').dataset.scrolled, 'true')
    host.querySelector('#confirm-next').click(); assert.equal(host.querySelector('[data-exception-key=b]').dataset.current, 'true')
    host.querySelector('[data-exception-key=b] button').click(); assert.deepEqual(resolved, ['b'])
    host.querySelector('#auto-matched-toggle').click(); assert.deepEqual(toggles, [false])
    w.edulogUi.setLocale('en'); assert.equal(host.querySelector('h2').textContent, 'Confirm 2 exceptions'); assert.match(host.textContent, /Changed on both sides/)
  } finally { delete globalThis.edulogUi; dom.window.close() }
})
