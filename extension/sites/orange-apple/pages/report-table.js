// Students table and the lesson-report table (class and 課次報告 pages): scrolling region,
// legend, filters, week columns and report cells. Runs on every page that has these tables.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.every('report-table', context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const students = content.querySelector('#students-table')
    if (students) scrollTable(scope, students, 'students')
    const reports = content.querySelector('#reports')
    if (reports) {
      mark(reports, 'data-edulog-dense-table', '')
      const scroll = scrollTable(scope, reports, 'reports')
      mark(scroll, 'data-edulog-report-region', '')
      mark(scroll,'role','region');mark(scroll,'aria-label',tx('課堂紀錄表，可依螢幕寬度捲動'));mark(scroll,'tabindex','0')
      // Source wrappers must not create nested vertical scroll areas.
      for (let parent = scroll.parentElement; parent && parent !== content; parent = parent.parentElement) mark(parent, 'data-edulog-scroll-parent', '')
      const legend = region(scope, '', 'edulog-report-legend')
      legend.append(element('p', tx('課程啟用與課堂記錄是不同狀態；請依原站記錄內容確認報告是否已填寫。')))
      const statisticsHeader = [...(reports.rows[0]?.cells || [])].find(cell => /出席統計/.test(site.canonLabel(text(cell))))
      const sourceHint = statisticsHeader?.querySelector('[data-bs-title],[title],[data-bs-original-title],[data-original-title]')
      const attendanceHint = sourceHint?.getAttribute('data-bs-title') || sourceHint?.getAttribute('title') || sourceHint?.getAttribute('data-bs-original-title') || sourceHint?.getAttribute('data-original-title')
      if (attendanceHint) legend.append(element('p', tx('出席統計：{hint}', { hint: attendanceHint })))
      scroll.before(legend)
      for (const alert of reports.closest('.tab-pane')?.querySelectorAll('.alert') || []) mark(alert, 'data-edulog-report-alert', '')
      const enhanceReportRow = row => {
        if (row.querySelector('td')) {
          mark(row, 'data-edulog-report-row', '')
          mark(row,'data-edulog-course-name',text(row.cells[1]))
          const sourceHeadings=[...(reports.rows[0]?.cells||[])].map(text)
          for(const [index,cell] of [...row.cells].entries())mark(cell,'data-edulog-column-label',sourceHeadings[index]||'')
          view.reportDetails ||= new WeakMap()
          if (!view.reportDetails.has(row)) view.reportDetails.set(row,new Map())
          const states = view.reportDetails.get(row)
          const details = []
          for (const [index,title] of [[2,tx('出席統計與專案')]]) {
            const cell = row.cells[index]; if (!cell || cell.querySelector(':scope > .edulog-report-details')) continue
            mark(cell, 'data-edulog-report-meta', '')
            const disclosure = scope.add(element('details')); disclosure.className = 'edulog-report-details'
            disclosure.append(element('summary', title))
            const body = element('div'); disclosure.append(body)
            const children = [...cell.childNodes]; cell.append(disclosure)
            for (const node of children) move(node, body)
            details.push({disclosure,key:index})
          }
          const studentActions = [...row.cells[0].querySelectorAll('a[href]')].filter(a => !/comments/.test(a.pathname) && !a.closest('.edulog-student-actions'))
          if (studentActions.length) {
            const disclosure = scope.add(element('details')); disclosure.className = 'edulog-report-details edulog-student-actions'
            disclosure.append(element('summary',tx('學生操作')))
            const body = element('div'); disclosure.append(body); row.cells[0].append(disclosure)
            for (const action of studentActions) move(action, body)
            details.push({disclosure,key:0})
          }
          const layout = () => { for (const {disclosure,key} of details) disclosure.open = doc.defaultView.innerWidth > 991 || states.get(key) === true }
          for (const {disclosure,key} of details) listen(disclosure,'toggle',()=>{ if (doc.defaultView.innerWidth <= 991) states.set(key, disclosure.open) })
          listen(doc.defaultView, 'resize', layout); layout()
        }
        const name = row.cells[0]?.querySelector(':scope > span,:scope > div > span')
        const cleanName=row.cells[0]?.cloneNode(true);cleanName?.querySelectorAll('a,button,input,select,textarea,details,[data-edulog-owned]').forEach(node=>node.remove())
        const student = text(name) || text(cleanName) || [...(row.cells[0]?.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ')
        mark(row,'data-edulog-student-name',student)
        for (const button of row.querySelectorAll('.btn,button,input[type=submit]')) mark(button,'data-edulog-action','')
        for (const a of row.querySelectorAll('a[href]')) {
          if (/\/reports\/\d+\/edit$/.test(a.pathname)) {
            const column = [...row.cells].indexOf(a.closest('td'))
            const week = text(reports.rows[0]?.cells[column])
            mark(a, 'aria-label', tx('{student} {week} 填寫課堂記錄', { student, week }))
            mark(a, 'data-edulog-record-action', '')
            scope.text(a, tx('課堂記錄'))
          } else if (/\/students\/\d+\/accounts$/.test(a.pathname)) {
            scope.text(a, tx('學習帳號設定')); mark(a, 'aria-label', tx('{student} 學習帳號設定', { student }))
          } else if (/\/students\/\d+\/teachers_comment$/.test(a.pathname)) {
            scope.text(a, tx('學生總評')); mark(a, 'aria-label', tx('{student} 學生總評', { student }))
          } else if (!text(a)) mark(a, 'aria-label', /comments/.test(a.pathname) ? tx('{student} 教學備註', { student }) : tx('{student} 原站操作', { student }))
        }
        const statistics = row.cells[2]?.querySelector('[title],[data-bs-original-title],[data-original-title]')
        // Use the source's explanation only; do not assign meaning to bare ratios.
        const explanation = statistics?.getAttribute('title') || statistics?.getAttribute('data-bs-original-title') || statistics?.getAttribute('data-original-title') || attendanceHint
        if (explanation) mark(row.cells[2], 'aria-label', `${text(row.cells[2])}：${explanation}`)
      }
      const refreshRows = () => { for (const row of reports.rows) if(!row.hasAttribute('data-edulog-last-teaching-row'))enhanceReportRow(row) }
      refreshRows(); refreshers.push(refreshRows)
      const weekHeaders = model.readWeekColumns(reports.rows[0]?.cells || [])
      const selectedWeek=()=>model.pickWeek(weekHeaders,Number(view.week))
      const reportLinkFor=(row,week)=>{
        for(const link of week&&row.cells[week.index]?.querySelectorAll('a[href]')||[])try{const url=new URL(link.getAttribute('href'),doc.location.href);if(url.origin===doc.location.origin&&/^\/dt_admissions\/\d+\/reports\/\d+\/edit\/?$/.test(url.pathname))return url}catch{}
        return null
      }
      const admissionFor=(row,week)=>{
        const report=reportLinkFor(row,week),match=report?.pathname.match(/^\/dt_admissions\/(\d+)\/reports\//)
        if(match)return `/dt_admissions/${match[1]}`
        for(const link of row.querySelectorAll('a[href]'))try{const url=new URL(link.getAttribute('href'),doc.location.href);if(url.origin===doc.location.origin&&/^\/dt_admissions\/\d+\/?$/.test(url.pathname))return url.pathname.replace(/\/$/,'')}catch{}
        return null
      }
      const historyRowUpdaters=new Map()
      const historyRowLoaders=new Map()
      const historyCache=view.classHistoryCache||(view.classHistoryCache=new Map())
      const historyRequests=view.classHistoryRequests||(view.classHistoryRequests=new Map())
      const historyRevisions=view.classHistoryRevisions||(view.classHistoryRevisions=new Map())
      const enrollmentId=path=>String(path||'').match(/^\/dt_admissions\/(\d+)\/?$/)?.[1]||null
      const makeHistoryPanel = row => {
        if (!row.cells[0] || row.querySelector('.edulog-last-teaching-toggle')) return
        const button=element('button',tx('查看上次教學'))
        scope.add(button);button.type='button';button.className='edulog-last-teaching-toggle';button.setAttribute('aria-expanded','false')
        const live=element('div');live.className='edulog-last-teaching-content';live.setAttribute('role','status');live.setAttribute('aria-live','polite')
        const reload=element('button',tx('重新整理上次教學'));reload.type='button';reload.hidden=true
        const disclosure=element('div');disclosure.className='edulog-last-teaching-panel';disclosure.hidden=true;disclosure.append(live,reload)
        const detailsRow=scope.add(element('tr'));detailsRow.className='edulog-last-teaching-row';detailsRow.hidden=true;detailsRow.dataset.edulogLastTeachingRow=''
        const detailsCell=element('td');detailsCell.colSpan=Math.max(1,reports.rows[0]?.cells.length||row.cells.length);detailsCell.append(disclosure);detailsRow.append(detailsCell);row.after(detailsRow)
        const actionCell=scope.add(element('div'));actionCell.className='edulog-teaching-actions';mark(actionCell,'data-edulog-owned','');actionCell.append(button)
        const statusSummaries=new Map()
        const session=(week=selectedWeek())=>{const cell=week&&row.cells[week.index];return week?{...week,cell,link:reportLinkFor(row,week),date:reportDate(week.label,week.cell),admission:admissionFor(row,week)}:null}
        const statusFor=target=>{
          const state=model.readSessionCell(target?.cell,{upcoming:words.nextWeek.test(target?.label||'')}),raw=state.raw,course=state.courseStatus||tx('原站未提供明確狀態')
          const attendanceLink=target?.cell?.querySelector('a[href*="attendance_status"]')
          const attendance=state.attendance||(attendanceLink?tx('原站提供設定入口，結果待確認'):tx('原站未提供明確出席結果'))
          const report=state.report||(target?.link?tx('可開啟課堂紀錄'):tx('原站未提供課堂紀錄入口'))
          const scheduled=state.scheduledLesson||tx('原站未提供')
          const enabled=state.enabledLesson||tx('原站未提供')
          const otherSession=state.otherSession
          return {raw,course,attendance,report,scheduled,enabled,otherSession,rank:otherSession?'other':target?.link?'current':'unknown'}
        }
        const makeWeekSummary=week=>{
          let summary=statusSummaries.get(week.index)
          if(summary)return summary
          summary=scope.add(element('div'));summary.className='edulog-session-status';summary.dataset.edulogWeekSummary=String(week.index);mark(summary,'data-edulog-owned','')
          const comparison=element('p');comparison.className='edulog-session-comparison';const details=element('details');details.className='edulog-session-extra';details.append(element('summary',tx('課程狀態與詳細資訊')));const body=element('div');details.append(body);summary.append(comparison,details)
          statusSummaries.set(week.index,{summary,comparison,details,body})
          return statusSummaries.get(week.index)
        }
        const updateStatus=()=>{
          const states=weekHeaders.map(week=>({week,target:session(week),status:null})).map(item=>({...item,status:statusFor(item.target)}))
          for(const {week,target,status} of states){
            if(!target?.cell)continue
            const nodes=makeWeekSummary(week),{summary,comparison,details,body}=nodes
            mark(target.cell,'data-edulog-week-status','')
            mark(target.cell,'data-edulog-week-selected',week.index===Number(view.week)?'':null)
            comparison.replaceChildren()
            const field=(label,value)=>{const item=element('span');item.append(element('strong',tx(label)),doc.createTextNode(' '),element('span',value));return item}
            const lesson=field('本堂排定進度',status.scheduled),enabled=field('已啟用教材',status.enabled),attendance=field('出席狀態',status.attendance),report=field('課堂紀錄',status.report)
            comparison.append(lesson,enabled,attendance,report)
            body.replaceChildren()
            for(const [label,value] of [['課程狀態',status.course],['課堂日期',target.date||tx('來源未提供完整日期')]]){const item=element('p');item.append(element('strong',tx('{label}：',{label:tx(label)})),doc.createTextNode(value));body.append(item)}
            mark(summary,'data-edulog-session-rank',status.rank)
            target.cell.append(summary)
          }
          const active=selectedWeek(),activeTarget=session(active),activeState=active&&statusFor(activeTarget)
          if(activeState){mark(row,'data-edulog-session-rank',activeState.rank);mark(detailsRow,'data-edulog-session-rank',activeState.rank);button.dataset.edulogAdmission=enrollmentId(activeTarget?.admission)||''}
        }
        const placeActions=()=>{updateStatus();row.cells[0]?.append(actionCell)}
        placeActions()
        historyRowUpdaters.set(row,placeActions)
        let sequence=0,expanded=false
        const appendField=(parent,label,value)=>{if(value===undefined||value===null||value==='')return;const item=element('p');const strong=element('strong',tx('{label}：',{label:tx(label)}));item.append(strong,doc.createTextNode(String(value)));parent.append(item)}
        const render=result=>{
          live.replaceChildren()
          if(result.status==='none'){live.append(element('p',tx('未找到所選課次日期之前、且含實際教學內容的紀錄。')));return}
          if(result.status==='ambiguous')live.append(element('p',tx('同一天有多份教學紀錄，無法可靠排序；請逐份查看。')))
          const reportsToShow=result.status==='found'?[result.report]:result.reports||[]
          for(const report of reportsToShow){
            const article=element('section');article.className='edulog-last-teaching-result'
            const title=element('h4',`${report.date||tx('日期未提供')}${report.lesson?` · ${report.lesson}`:''}`);article.append(title)
            appendField(article,'完成狀況',report.completed===true?tx('已完成'):report.completed===false?tx('未完成'):tx('未提供'))
            appendField(article,'章節進度',report.progress)
            const noteLines=String(report.internalNotes||'').split(/\r?\n/)
            if(noteLines.length<=3)appendField(article,'內部紀錄',report.internalNotes)
            else{appendField(article,'內部紀錄',noteLines.slice(0,3).join('\n'));const fullNotes=element('details');fullNotes.append(element('summary',tx('展開完整內部紀錄')));const pre=element('pre');pre.textContent=report.internalNotes;fullNotes.append(pre);article.append(fullNotes)}
            const more=element('details');more.append(element('summary',tx('評語、評分與聯絡欄')))
            const body=element('div');appendField(body,'學習表現',report.content);appendField(body,'課程參與評分',report.participation);appendField(body,'課堂秩序評分',report.behavior);appendField(body,'聯絡欄',report.contactNotes)
            if(body.children.length){more.append(body);article.append(more)}
            if(report.externalLink){try{const url=new URL(report.externalLink,doc.location.href);if(url.origin===doc.location.origin){const link=element('a',tx('查看原站紀錄'));link.href=url.href;link.target='_blank';link.rel='noopener';article.append(link)}}catch{}}
            live.append(article)
          }
          const time=element('p');time.className='edulog-last-teaching-read-at';time.append(element('strong',tx('讀取時間：')),doc.createTextNode(new Date(result.readAt||Date.now()).toLocaleString(doc.documentElement.lang||'zh-TW')));live.append(time)
        }
        const load=async(force=false,{isActive=()=>true}={})=>{
          const target=session(),id=++sequence
          reload.hidden=false;reload.disabled=true;live.replaceChildren(element('p',tx('正在讀取此學生的相關報名與教學紀錄…')))
          if(!target?.admission||!target.link){live.replaceChildren(element('p',tx('無法從本堂原站連結可靠識別報名與報告，請使用原站紀錄或從學生名單開啟報名。')));reload.disabled=false;return false}
          try{
            const integration=globalThis.edulogSourceIntegration
            if(typeof integration?.readPreviousTeaching!=='function')throw new Error(tx('目前擴充功能版本不支援按需讀取，請重新載入擴充功能後重試。'))
            let date=target.date
            if(!date){if(typeof integration.resolveSessionDate!=='function')throw new Error(tx('來源沒有完整日期，且目前版本無法從報告編輯頁補讀日期。'));date=(await integration.resolveSessionDate(target.admission,target.link.href)).date}
            const idNumber=enrollmentId(target.admission);if(!idNumber)throw new Error(tx('報名識別資料無效，請從原站報名頁重新開啟。'))
            const key=`${idNumber}|${date}`,revision=historyRevisions.get(idNumber)||0
            if(!force&&historyCache.has(key)){if(id===sequence&&row.isConnected&&isActive()){render(historyCache.get(key));reload.disabled=false;return true}}
            let request=historyRequests.get(key)
            if(!request||force){request=Promise.resolve(integration.readPreviousTeaching(target.admission,date));historyRequests.set(key,request);void request.then(()=>{if(historyRequests.get(key)===request)historyRequests.delete(key)},()=>{if(historyRequests.get(key)===request)historyRequests.delete(key)})}
            const result=await request
            if(id!==sequence||!row.isConnected||doc.location.pathname!==pagePath||session()?.index!==target.index||!isActive())return false
            if((historyRevisions.get(idNumber)||0)!==revision)return false
            historyCache.set(key,result)
            render(result);return true
          }catch(error){if(id===sequence&&row.isConnected&&isActive()){const failure=element('p');failure.append(element('strong',tx('讀取失敗：')),doc.createTextNode(error?.message||tx('未知錯誤')),doc.createTextNode(' '),element('span',tx('請重新整理此學生的摘要。')));live.replaceChildren(failure)}return false}
          finally{if(id===sequence)reload.disabled=false}
        }
        historyRowLoaders.set(row,load)
        listen(button,'click',()=>{expanded=!expanded;if(!expanded)sequence++;button.setAttribute('aria-expanded',String(expanded));disclosure.hidden=!expanded;detailsRow.hidden=!expanded;live.hidden=false;if(expanded)void load()})
        listen(reload,'click',()=>void load(true))
        const onWeekChange=()=>{sequence++;view.cancelClassHistory?.();placeActions();if(expanded){live.hidden=false;live.replaceChildren(element('p',tx('目前課次已變更；請按「重新整理上次教學」讀取對應摘要。')));reload.hidden=false;reload.disabled=false}}
        listen(doc,'edulog:week-change',onWeekChange)
        listen(doc,'turbo:submit-end',event=>{
          const form=event.target?.matches?.('form')?event.target:null
          if(!form||event.detail?.success!==true)return
          let submittedAdmission=null
          try{const url=new URL(form.action,doc.location.href),match=url.pathname.match(/^\/dt_admissions\/(\d+)\/reports(?:\/\d+(?:\/edit)?)?\/?$/);if(url.origin===doc.location.origin)submittedAdmission=match?.[1]||null}catch{}
          if(!submittedAdmission)return
          const currentId=enrollmentId(session()?.admission);if(submittedAdmission!==currentId)return
          sequence++
          historyRevisions.set(submittedAdmission,(historyRevisions.get(submittedAdmission)||0)+1)
          const prefix=`${submittedAdmission}|`;for(const key of historyCache.keys())if(key.startsWith(prefix))historyCache.delete(key)
          for(const key of historyRequests.keys())if(key.startsWith(prefix))historyRequests.delete(key)
          for(const [candidate,update] of historyRowUpdaters)if(candidate.isConnected&&candidate.querySelector('.edulog-last-teaching-toggle')?.dataset.edulogAdmission===submittedAdmission)update()
          if(!expanded)return
          live.replaceChildren(element('p',tx('原站已確認保存。上次教學摘要已更新為待重新讀取。')));reload.hidden=false;reload.disabled=false
        })
      }
      for(const row of reports.rows)if(row.querySelector('td')&&!row.hasAttribute('data-edulog-last-teaching-row'))makeHistoryPanel(row)
      let batchRun=0
      view.updateClassHistoryAvailability=()=>{
        const week=selectedWeek(),eligible=[...historyRowLoaders.keys()].filter(row=>{const cell=week&&row.cells[week.index];if(!cell||words.otherSession.test(text(cell)))return false;return Boolean(reportLinkFor(row,week)&&admissionFor(row,week))})
        view.classHistoryEligibleCount=eligible.length
        if(view.classHistoryAvailabilityValue)view.classHistoryAvailabilityValue.data=` ${eligible.length} `
        if(view.classHistoryAvailabilityWeek)view.classHistoryAvailabilityWeek.textContent=week?.label?model.weekTitle(week.label):tx('原站未標示課次')
      }
      view.loadClassHistory=async({onProgress=()=>{},isActive=()=>true}={})=>{
        const run=++batchRun,week=selectedWeek(),targets=[...historyRowLoaders.entries()].filter(([row])=>{const cell=week&&row.cells[week.index];return Boolean(cell&&!words.otherSession.test(text(cell))&&reportLinkFor(row,week)&&admissionFor(row,week))})
        let next=0,done=0,failed=0
        const active=()=>run===batchRun&&isActive()&&selectedWeek()?.index===week?.index
        const worker=async()=>{while(active()){const index=next++;if(index>=targets.length)return;const [,load]=targets[index];const ok=await load(false,{isActive:active});if(run!==batchRun)return;if(ok)done++;else failed++;onProgress({done,failed,total:targets.length})}}
        await Promise.all(Array.from({length:Math.min(3,targets.length)},worker))
        return {done,failed,total:targets.length,cancelled:run!==batchRun}
      }
      view.cancelClassHistory=()=>{batchRun++}
      refreshers.push(()=>{for(const row of reports.rows)if(row.querySelector('td')&&!row.hasAttribute('data-edulog-last-teaching-row'))makeHistoryPanel(row);for(const [row,update] of historyRowUpdaters)if(row.isConnected)update();view.updateClassHistoryAvailability()})
    }
  })
})()
