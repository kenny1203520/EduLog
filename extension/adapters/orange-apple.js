// Provider page enhancement. Routes, selectors and wording live in orange-apple-lexicon.js.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel
  const words = lexicon.text
  const matchPage = model.matchPage
  function createScope(doc) {
    const changes = new Map(), added = [], listeners = [], moves = [], texts = new Map()
    let restored = false
    return {
      text(node, value) { if (!node || node.textContent === value) return; if (!texts.has(node)) texts.set(node, [...node.childNodes]); node.textContent = value },
      mark(node, name, value = '') {
        if (!node) return
        if (!changes.has(node)) changes.set(node, new Map())
        const attrs = changes.get(node)
        if (!attrs.has(name)) attrs.set(name, node.getAttribute(name))
        if (value === null) node.removeAttribute(name)
        else node.setAttribute(name, value)
      },
      listen(node, event, handler) { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)) },
      element(tag, text) { const node = doc.createElement(tag); node.dataset.edulogOwned = ''; if (text) node.textContent = globalThis.edulogUiLegacy?.translate(text) || text; if(text&&globalThis.edulogUiLegacy){const ownedText=node.firstChild;listeners.push(globalThis.edulogUi.subscribe(()=>{if(ownedText?.parentNode===node)ownedText.data=globalThis.edulogUiLegacy.translate(text)}))} return node },
      add(node) { added.push(node); return node },
      move(node, destination) {
        const anchor = doc.createElement('span'); anchor.dataset.edulogOwned = ''; anchor.hidden = true
        node.before(anchor); moves.push({ node, anchor }); destination.append(node)
      },
      restore() {
        if (restored) return
        restored = true
        for (const remove of listeners) remove()
        for (const { node, anchor } of [...moves].reverse()) {
          // A native update may have removed the moved field but left our anchor.
          if (anchor.isConnected && !node.isConnected) anchor.remove()
          else if (anchor.parentNode) anchor.replaceWith(node)
        }
        for (const node of [...added].reverse()) {
          // Keep native replacements inserted inside an extension wrapper.
          if (node.isConnected) {
            const preserve = container => {
              for (const child of [...container.children]) {
                if (child.hasAttribute('data-edulog-owned')) preserve(child)
                else node.before(child)
              }
            }
            preserve(node)
          }
          node.remove()
        }
        for (const [node, children] of texts) node.replaceChildren(...children)
        for (const [node, attrs] of changes) for (const [name, old] of attrs) {
          if (old === null) node.removeAttribute(name); else node.setAttribute(name, old)
        }
        listeners.length = moves.length = added.length = 0
        changes.clear(); texts.clear()
      },
    }
  }
  function enhancePage(doc, view = {}, documentMode = false) {
    const page = matchPage(doc.location.pathname)
    if (!page || !model.checkPage(doc, page.kind).ok) return null
    const content = doc.querySelector(lexicon.selectors.content)
    const hoursForm = page.kind === 'hours' ? [...content.querySelectorAll('form')].find(form => ['year', 'month'].every(name => form.querySelector(`select[name=${name}]`)?.form === form)) : null
    if (page.kind === 'hours' && !hoursForm) return null
    const hoursInputs = hoursForm && ['year', 'month'].map(name => hoursForm.querySelector(`select[name=${name}]`))
    if (page.kind === 'profile' && (!content.querySelector('h1') || !content.querySelector('a[href^="/my/"][href$="/edit"]'))) return null
    if (page.kind === 'profile-edit' && !content.querySelector('form[action^="/my/"] .form-inputs')) return null
    const scope = createScope(doc)
    try {
    const { mark, listen, element } = scope
    const added = { push: node => scope.add(node) }
    function controls(table, label) {
      const box = element('div')
      box.className = 'edulog-table-tools'
      const field = element('label')
      field.append(element('span', label))
      const input = element('input')
      input.type = 'search'; input.placeholder = '搜尋目前頁面的學生'
      field.append(input)
      const count = element('span')
      count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite')
      box.append(field, count); (table.closest('[data-edulog-scroll],.table-responsive') || table).before(box); added.push(box)
      return { box, input, count }
    }
    if (!documentMode) {
      mark(doc.documentElement, 'data-edulog-ui', 'on')
      mark(doc.documentElement, 'data-edulog-page', page.kind)
    }
    if (page.kind === 'overview') {
      const links = [...doc.querySelectorAll('.sidebar a[href]')].filter(a => {
        try { const url = new URL(a.href); return url.origin === doc.location.origin && /^\/courses\/dt\/\d+\/?$/.test(url.pathname) }
        catch { return false }
      })
      const unique = [...new Map(links.map(a => [a.href, a])).values()]
      if (unique.length) {
        const shortcuts = element('section')
        shortcuts.className = 'edulog-class-shortcuts'
        shortcuts.setAttribute('aria-label', '我的班級')
        shortcuts.append(element('h2', '我的班級'))
        const grid = element('div')
        for (const original of unique) {
          const link = element('a')
          link.href = original.href
          link.append(element('strong', original.textContent.trim()), element('span', '開啟班級工作區 →'))
          grid.append(link)
        }
        shortcuts.append(grid); content.prepend(shortcuts); added.push(shortcuts)
      }
    }
    let refreshStudents = () => {}, refreshReports = () => {}
    const students = content.querySelector(lexicon.selectors.studentsTable)
    if (students) {
      view.expandedStudents ||= new WeakSet()
      const { input, count } = controls(students, '目前名單篩選')
      input.dataset.edulogSearch = 'students'
      input.value = view.studentQuery || ''
      const headerRow = [...students.rows].find(r => [...r.cells].some(c => words.nameHeader.test(c.textContent))) || students.tHead?.rows[0]
      mark(headerRow, 'data-edulog-student-header', '')
      for (const row of students.rows) if (row.querySelector(lexicon.selectors.studentPicker) || row.querySelector('input[type=search],input[placeholder*="學生"]')) mark(row, 'data-edulog-student-search', '')
      const headers = [...(headerRow?.cells || [])].map(h => h.textContent.trim())
      const nameIndex = Math.max(0, headers.findIndex(h => words.nameHeader.test(h)))
      // Roster cards replace the table view; the native rows stay the source and filter target.
      const rosterView = globalThis.edulogSiteRoster?.mount({ doc, scope, table: students, box: input.closest('.edulog-table-tools'), view, onChange: () => refreshStudents() }) || null
      mark(headerRow?.cells[nameIndex], 'data-edulog-name', '')
      refreshStudents = () => {
        const rows = [...students.tBodies].flatMap(body => [...body.rows]).filter(row => row !== headerRow && !row.querySelector('th') && !row.hasAttribute('data-edulog-student-search'))
        let visible = 0
        const searched = new Set()
        for (const row of rows) {
          const found = row.textContent.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase())
          if (found) searched.add(row)
          const matches = found && (!rosterView || rosterView.allows(row))
          mark(row, 'data-edulog-filtered', matches ? null : '')
          if (matches) visible++
          for (const [index, cell] of [...row.cells].entries()) {
            mark(cell, 'data-edulog-label', headers[index] || '')
            if (index > 1 && !words.studentCoreColumn.test(headers[index] || '')) mark(cell, 'data-edulog-extra', '')
          }
          const nameCell = row.cells[nameIndex]
          mark(nameCell, 'data-edulog-name', '')
          if (nameCell && !nameCell.querySelector('[data-edulog-expand]')) {
            const button = element('button', '更多資料')
            button.type = 'button'; button.dataset.edulogExpand = ''
            const wasExpanded = view.expandedStudents.has(row)
            button.setAttribute('aria-expanded', String(wasExpanded))
            button.textContent = wasExpanded ? '收合資料' : '更多資料'
            mark(row, 'data-edulog-expanded', wasExpanded ? '' : null)
            listen(button, 'click', () => {
              const expanded = button.getAttribute('aria-expanded') !== 'true'
              button.setAttribute('aria-expanded', String(expanded))
              button.textContent = expanded ? '收合資料' : '更多資料'
              if (expanded) view.expandedStudents.add(row)
              else view.expandedStudents.delete(row)
              mark(row, 'data-edulog-expanded', expanded ? '' : null)
            })
            nameCell.append(button); added.push(button)
          }
        }
        rosterView?.render(searched)
        const text = `顯示 ${visible} / ${rows.length} 位學生`
        if (count.textContent !== text) count.textContent = text
        view.studentQuery = input.value
      }
      listen(input, 'input', refreshStudents); refreshStudents()
    }
    const workflow = globalThis.edulogSiteWorkflows?.enhancePage({ doc, content, page, view, scope })
    // The weekly to-do view leads the overview; the native schedule stays below it.
    if (page.kind === 'overview') view.todo = globalThis.edulogSiteTodo?.mount({ doc, content, scope, view })
    const reports = content.querySelector(lexicon.selectors.reportsTable)
    if (reports) {
      const reportScrollRegion=reports.closest('[data-edulog-scroll="reports"]')||reports.parentElement
      const { box, input, count } = controls(reports, '報告學生搜尋')
      count.remove() // the filter chips carry the counts
      const cardsApi = globalThis.edulogSiteSessionCards
      const roster = cardsApi ? cardsApi.readRoster(doc) : new Map()
      // The provider's "請先點名…" alert and its show-this-week/all toggles are replaced by the chips.
      for (const alert of content.querySelectorAll(lexicon.selectors.reportAlert)) if (alert.querySelector(lexicon.selectors.reportAlertToggle)) mark(alert, 'data-edulog-replaced', '')
      input.dataset.edulogSearch = 'reports'
      input.value = view.reportQuery || ''
      const weekButtons = element('div')
      weekButtons.className = 'edulog-week-tools'
      weekButtons.setAttribute('role', 'group'); weekButtons.setAttribute('aria-label', '課次與顯示方式')
      const weeks = model.readWeekColumns(reports.querySelectorAll('tr:first-child th'))
      const selected = model.pickWeek(weeks, view.week)
      const singleButton=element('button','單堂清單'),compareButton=element('button','三週比較')
      singleButton.type=compareButton.type='button';singleButton.dataset.reportMode='single';compareButton.dataset.reportMode='compare'
      listen(singleButton,'click',()=>selectMode('single'));listen(compareButton,'click',()=>selectMode('compare'))
      weekButtons.append(singleButton,compareButton)
      const dateContext = event => {
        const link = event.target.closest('a[data-edulog-record-action]')
        if (!link) return
        const row = link.closest('tr'), column = [...row.cells].indexOf(link.closest('td'))
        const label = reports.rows[0]?.cells[column]?.textContent.trim()
        if (label) view.reportTarget = { path: link.pathname, label }
      }
      listen(reports, 'click', dateContext)
      function selectMode(mode) {
        view.reportMode=mode==='compare'?'compare':'single'
        for(const button of [singleButton,compareButton])button.setAttribute('aria-pressed',String(button.dataset.reportMode===view.reportMode))
        mark(reports,'data-edulog-week-mode',view.reportMode)
        for(const button of weekButtons.querySelectorAll('[data-week]'))button.hidden=view.reportMode==='compare'
        if(typeof refreshReports==='function')refreshReports()
      }
      function selectWeek(index, forceProjection = false) {
        const changed=view.week!==index
        view.week = index
        for (const button of weekButtons.querySelectorAll('[data-week]')) button.setAttribute('aria-pressed', String(Number(button.dataset.week) === index))
        for (const row of reports.rows) for (const [column, cell] of [...row.cells].entries()) {
          if (weeks.some(w => w.index === column)) {
            mark(cell, 'data-edulog-week-cell', '')
            mark(cell, 'data-edulog-week-selected', column === index ? '' : null)
          }
        }
        const label=weeks.find(week=>week.index===index)?.label||''
        if(changed||forceProjection)doc.dispatchEvent(new doc.defaultView.CustomEvent('edulog:week-change',{detail:{index,label,mode:view.reportMode||'single'}}))
        if(changed&&typeof refreshReports==='function')refreshReports()
      }
      for (const week of weeks) {
        const button = element('button');button.textContent=week.label
        button.type = 'button'; button.dataset.week = String(week.index)
        listen(button, 'click', () => selectWeek(week.index)); weekButtons.append(button)
      }
      if (weeks.length) box.append(weekButtons)
      const chips = cardsApi?.createChips({ doc, scope, onSelect: chip => { view.reportFilter = chip; view.reportFilterChosen = true; refreshReports() } })
      if (chips) box.append(chips.element)
      // Single-session mode shows extension cards; the native table stays in the DOM, hidden.
      const cards = cardsApi?.mountCards({ doc, scope, anchor: reportScrollRegion, onChange: () => { if (cards?.element.isConnected) refreshReports() } })
      refreshReports = () => {
        const rows = [...reports.rows].filter(row => row.hasAttribute('data-edulog-report-row'))
        const activeWeek=view.week??selected?.index
        if(activeWeek!==undefined)view.week=activeWeek
        mark(reportScrollRegion,'data-edulog-report-mode',view.reportMode||'single')
        const isCompare=(view.reportMode||'single')==='compare'
        const week=weeks.find(item=>item.index===activeWeek)||selected
        const session=cardsApi&&week?cardsApi.readSession(reports,week,roster):{label:'',upcoming:false,students:[]}
        const byRow=new Map(session.students.map(student=>[student.row,student]))
        const counts=cardsApi?cardsApi.countChips(session.students):{}
        // Until the teacher picks a chip, show what needs action, or everyone once nothing does.
        if(!view.reportFilterChosen||!cardsApi?.CHIPS.some(([chip])=>chip===view.reportFilter))view.reportFilter=cardsApi?cardsApi.defaultChip(counts):'all'
        const query=input.value.trim().toLocaleLowerCase(),visible=new Set()
        for (const row of rows) {
          const student=byRow.get(row)
          const otherSession=isCompare?weeks.length>0&&weeks.every(item=>model.readSessionCell(row.cells[item.index]).otherSession):student?student.other:Boolean(week&&model.readSessionCell(row.cells[week.index]).otherSession)
          mark(row,'data-edulog-session-rank',otherSession?'other':student?.recordLink?'current':'unknown')
          const chipMatch=!student||!cardsApi||cardsApi.matchesChip({...student,other:otherSession},view.reportFilter)
          const matches=(row.getAttribute('data-edulog-student-name')||'').toLocaleLowerCase().includes(query)&&chipMatch
          mark(row, 'data-edulog-filtered', matches ? null : '')
          const detail=row.nextElementSibling;if(detail?.hasAttribute('data-edulog-last-teaching-row'))detail.hidden=!matches||row.querySelector('.edulog-last-teaching-toggle')?.getAttribute('aria-expanded')!=='true'
          if (matches) visible.add(row)
        }
        if (selected) {
          mark(reports,'data-edulog-week-mode',view.reportMode||'single')
          for(const button of weekButtons.querySelectorAll('[data-report-mode]'))button.setAttribute('aria-pressed',String(button.dataset.reportMode===(view.reportMode||'single')))
          for(const button of weekButtons.querySelectorAll('[data-week]'))button.setAttribute('aria-pressed',String(Number(button.dataset.week)===activeWeek))
        }
        chips?.update(counts,view.reportFilter)
        // Share this class's pending count with the navigation bar (no extra reads elsewhere).
        const classPath=(doc.location.pathname.match(/^\/courses\/dt\/\d+/)||[])[0]
        if(classPath&&cardsApi)(globalThis.edulogClassPending||(globalThis.edulogClassPending=new Map())).set(classPath,counts.pending||0)
        cards?.render({session,visible,chip:view.reportFilter,counts,hidden:isCompare})
        mark(reportScrollRegion,'data-edulog-cards',cards&&!isCompare?'on':null)
        if(typeof view.updateClassHistoryAvailability==='function')view.updateClassHistoryAvailability()
        view.reportQuery = input.value
      }
      const historyTools=element('section');historyTools.className='edulog-class-history-tools';historyTools.setAttribute('aria-label','上次教學摘要')
      const availability=element('p');availability.setAttribute('role','status');availability.setAttribute('aria-live','polite');const availabilityValue=doc.createTextNode(' 0 '),availabilityWeek=element('span');availability.append(element('span','可讀取'),availabilityValue,element('span','位本堂學生的上次教學摘要 · 讀取課次：'),availabilityWeek)
      const loadAll=element('button','載入此課次全部摘要');loadAll.type='button'
      const stopAll=element('button','停止載入');stopAll.type='button';stopAll.hidden=true
      const progress=element('p');progress.hidden=true;progress.setAttribute('role','status');progress.setAttribute('aria-live','polite')
      const progressStates=Object.fromEntries(['正在讀取','讀取進度','讀取完成；成功','已停止讀取；已完成的摘要會保留。','讀取失敗'].map(key=>[key,element('span',key)]));for(const item of Object.values(progressStates))item.hidden=true
      const progressDone=doc.createTextNode(' 0 / 0 '),progressTotal=element('span','位已讀取 · 失敗需重試'),progressFailed=doc.createTextNode(' 0')
      progress.append(progressStates['正在讀取'],progressDone,progressTotal,progressStates['讀取進度'],progressStates['讀取完成；成功'],progressStates['已停止讀取；已完成的摘要會保留。'],progressFailed)
      progress.append(progressStates['讀取失敗'])
      historyTools.append(availability,loadAll,stopAll,progress)
      const moreTools=element('details');moreTools.className='edulog-more-tools';moreTools.append(element('summary','更多'),historyTools);box.append(moreTools)
      view.classHistoryAvailability=availability
      view.classHistoryAvailabilityValue=availabilityValue
      view.classHistoryAvailabilityWeek=availabilityWeek
      let historyRun=0
      listen(loadAll,'click',async()=>{
        progress.hidden=false
        if(typeof view.loadClassHistory!=='function'){progress.textContent='目前版本無法載入整班摘要，請重新載入頁面後重試。';return}
        const run=++historyRun;loadAll.disabled=true;stopAll.hidden=false
        const total=Number(view.classHistoryEligibleCount)||0
        const showProgress=(label,value)=>{for(const [key,node] of Object.entries(progressStates))node.hidden=key!==label;progressDone.data=` ${value.done} / ${value.total} `;progressFailed.data=` ${value.failed}`}
        showProgress('正在讀取', {done:0,total,failed:0})
        let result
        try {
          result=await view.loadClassHistory({isActive:()=>run===historyRun,onProgress:value=>{if(run===historyRun)showProgress('讀取進度',value)}})
        } catch {
          if(run===historyRun){stopAll.hidden=true;loadAll.disabled=false;for(const [key,node] of Object.entries(progressStates))node.hidden=key!=='讀取失敗'}
          return
        }
        if(run!==historyRun)return
        stopAll.hidden=true;loadAll.disabled=false
        showProgress(result.cancelled?'已停止讀取；已完成的摘要會保留。':'讀取完成；成功',{done:result.done,total:result.total,failed:result.failed})
      })
      listen(stopAll,'click',()=>{historyRun++;view.cancelClassHistory?.();stopAll.hidden=true;loadAll.disabled=false;for(const [key,node] of Object.entries(progressStates))node.hidden=key!=='已停止讀取；已完成的摘要會保留。'})
      listen(input, 'input', refreshReports); refreshReports()
      // Apply the initial week through the same projection used by later clicks.
      // The workflow has already enhanced the native rows, so this also moves
      // per-session actions into the selected cell before the table is shown.
      if(selected)selectWeek(selected.index,true)
    }
    // One left navigation bar built from the provider sidebar (after readers above used it).
    view.navigation = globalThis.edulogSiteNavigation?.mount({ doc, scope }) || null
    const sourceTables = [...content.querySelectorAll('table')]
    const shape = sourceTables.map(table => ({ table, rows: table.rows.length }))
    return {
      page,
      isCurrent() {
        return doc.querySelector('#page-body > .content') === content && (!hoursInputs || hoursInputs.every(input => input.form === hoursForm && hoursForm.contains(input) && hoursForm.querySelector(`select[name=${input.name}]`) === input)) && sourceTables.length === content.querySelectorAll('table').length && shape.every(({ table, rows }) => table.isConnected && table.rows.length === rows)
      },
      refresh() {
        try { refreshStudents(); refreshReports(); workflow?.refresh() }
        catch (error) { scope.restore(); throw error }
      },
      restore: scope.restore,
    }
    } catch (error) { scope.restore(); throw error }
  }
  globalThis.edulogSiteAdapter = Object.freeze({
    id: 'orange-apple', matchesHost: host => host === 'corp.orangeapple.co',
    matchesTeachingPage: path => { const page = matchPage(path); return Boolean(page && page.kind !== 'report-editor') },
    matchesIntegrationPage: path => Boolean(matchPage(path)), matchPage, enhancePage,
    enhanceDialog(doc, view) {
      const scope = createScope(doc)
      try { return globalThis.edulogSiteWorkflows?.enhanceDialog(doc, view, scope) }
      catch (error) { scope.restore(); throw error }
    },
    enhanceDialogs(doc, view) {
      const scopes = []
      try { return globalThis.edulogSiteWorkflows?.enhanceDialogs(doc, view, document => {
        const scope = createScope(document); scopes.push(scope); return scope
      }) }
      catch (error) { for (const scope of scopes.reverse()) scope.restore(); throw error }
    },
    checkPage: (doc, kind = matchPage(doc.location.pathname)?.kind) => model.checkPage(doc, kind),
    lexicon, model,
    readContext: doc => ({ ...matchPage(doc.location.pathname), sourcePath: doc.location.pathname }),
  })
})()
