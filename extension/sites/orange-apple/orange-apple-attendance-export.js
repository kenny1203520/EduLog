// "複製出席": a plain-text attendance summary for pasting into LINE or a message.
// Reads only what the lesson report table already shows; nothing is sent or saved.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel
  if (!lexicon || !model) return
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const STATUS = { present: '出席', absent: '缺席', unmarked: '未點名' }

  // One entry per week: every report row's state in that week's column.
  function collect({ reports, weeks }) {
    const rows = [...reports.querySelectorAll('tr[data-edulog-report-row]')]
    return weeks.map(week => {
      const students = rows.map(row => {
        const name = collapse(row.cells[0]?.querySelector(':scope > span')?.textContent) || row.getAttribute('data-edulog-student-name') || ''
        const state = model.readSessionCell(row.cells[week.index])
        const status = state.otherSession ? '非本班' : state.courseStatus ? '暫停' : STATUS[state.attendanceMark] || null
        return { name, status }
      }).filter(student => student.name && student.status)
      return { label: week.label, date: /(\d{1,2}\/\d{1,2})/.exec(week.label)?.[1] || week.label, upcoming: lexicon.text.nextWeek.test(week.label), students }
    })
  }

  // 應出 leaves out students who are paused or not in this class that week; they get their own line.
  function toText({ title, weeks }) {
    const sections = weeks.map(week => {
      const names = status => week.students.filter(student => student.status === status).map(student => student.name)
      const expected = week.students.filter(student => Object.values(STATUS).includes(student.status)).length
      // Next week has not happened yet: nobody is "未點名", so only the head count is useful.
      const lines = [week.upcoming ? `${week.date} 尚未上課｜應出 ${expected}` : `${week.date} 應出 ${expected}｜出席 ${names('出席').length}｜缺席 ${names('缺席').length}｜未點名 ${names('未點名').length}`]
      for (const status of week.upcoming ? ['暫停', '非本班'] : ['缺席', '未點名', '暫停', '非本班']) if (names(status).length) lines.push(`${status}：${names(status).join('、')}`)
      return lines.join('\n')
    })
    return (title ? `${title}\n` : '') + sections.join('\n\n')
  }

  // The class name as the page states it: the breadcrumb text after the last link.
  function classTitle(doc) {
    const content = doc.querySelector(lexicon.selectors.content)
    const link = [...(content?.querySelectorAll(':scope > a[href]') || [])].pop()
    const crumb = link?.nextSibling?.nodeType === 3 ? collapse(link.nextSibling.textContent.replace(/^\s*>\s*/, '')) : ''
    return crumb || collapse(globalThis.edulogSiteNavigation?.currentClass(doc)?.full)
  }

  function mountButton({ doc, scope, getWeeks, label = '複製出席' }) {
    const { element, listen } = scope
    const box = element('div'); box.className = 'edulog-copy-attendance'
    const button = element('button', label); button.type = 'button'
    const status = element('span'); status.className = 'edulog-visually-hidden'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const fallback = element('textarea'); fallback.readOnly = true; fallback.hidden = true; fallback.rows = 5; fallback.setAttribute('aria-label', '出席摘要，請手動複製')
    box.append(button, status, fallback)
    let reset = 0
    listen(button, 'click', async () => {
      const weeks = getWeeks()
      if (!weeks?.length) return
      const text = toText({ title: classTitle(doc), weeks })
      const win = doc.defaultView
      win.clearTimeout(reset)
      try {
        if (!win.navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
        await win.navigator.clipboard.writeText(text)
        fallback.hidden = true
        button.textContent = '已複製'
        status.textContent = '已複製出席摘要'
        reset = win.setTimeout(() => { button.textContent = label; status.textContent = '' }, 2000)
      } catch {
        // No clipboard access (permissions, insecure frame): show the text, selected, to copy by hand.
        fallback.value = text; fallback.hidden = false
        fallback.focus(); fallback.select()
        status.textContent = '無法自動複製，請手動複製下方文字'
      }
    })
    return box
  }
  globalThis.edulogSiteAttendanceExport = Object.freeze({ collect, toText, classTitle, mountButton })
})()
