(() => {
  const flows = [
    { id: 'import', title: '教學資料匯入', summary: '將支援網站的教學資料整理到你的 EduLog。', steps: [
      ['選擇資料範圍', '學生、課程、班級、報名、課次及既有報告；日期預設近一年。'],
      ['檢查來源對應', '使用來源 ID 配對，無可靠識別的資料需人工確認。'],
      ['確認新增與差異', '分開顯示新增、更新與衝突；衝突預設保留 EduLog 內容。'],
      ['分批匯入', '確認後才寫入；工作中斷可續傳，不因來源缺漏刪除 EduLog 紀錄。'],
    ], note: '只匯入目前帳號可見的教學資料，不包含額外聯絡、地址或證件資料。' },
    { id: 'prefill', title: '報告預填', summary: '將 EduLog 報告帶入支援網站的原生表單。', steps: [
      ['選擇目標學生與課次', '使用已匯入對應，或人工配對並記住結果。'],
      ['選擇 EduLog 報告', '查看報告完整性，確認學生和日期。課程完成狀況另行呈現。'],
      ['檢查欄位對照', '逐項確認出席、進度、評量、評語及內部紀錄；未知欄位不猜測。'],
      ['預填後人工送出', '你在原站檢查並送出；取得成功訊號與報告網址後才回寫紀錄。'],
    ], note: '預填不等於送出；無法確認網站成功時，會維持待確認狀態。' },
  ]
  const styles = `.edulog-integration{font:inherit;color:inherit}.edulog-integration h2{font-size:15px;margin:0 0 12px}.edulog-flow{border:1px solid #dbe3ee;border-radius:10px;margin-top:12px;overflow:hidden;background:#fff}.edulog-flow summary{cursor:pointer;min-height:44px;padding:14px;list-style:none;display:block}.edulog-flow summary::-webkit-details-marker{display:none}.edulog-flow summary:focus-visible{outline:3px solid #2563eb;outline-offset:-3px}.edulog-flow-heading{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}.edulog-flow-title{font-size:14px;color:#172033}.edulog-flow-state{font-size:12px;color:#475569;background:#f1f5f9;padding:3px 7px;border-radius:6px}.edulog-flow-description,.edulog-flow-availability{display:block;font-size:13px;line-height:1.6;color:#475569;margin-top:8px}.edulog-flow-expand{display:block;color:#1e40af;font-size:13px;margin-top:8px}.edulog-flow[open] .edulog-flow-expand{display:none}.edulog-flow-body{padding:0 14px 14px}.edulog-flow-body p{font-size:13px;color:#475569;margin:8px 0}.edulog-flow ol{padding-left:22px;margin:12px 0}.edulog-flow li{padding:0 0 12px 4px}.edulog-flow li strong{display:block;color:#172033;font-size:13px}.edulog-flow li span{font-size:13px;color:#475569;line-height:1.6;display:block;margin-top:4px}`
  globalThis.edulogIntegrationUi = Object.freeze({
    theme: { name: 'EduLog 清晰主題', apply: '套用清晰主題', original: '使用原站主題' },
    mount(container) {
      const doc = container.ownerDocument
      container.classList.add('edulog-integration')
      const style = doc.createElement('style'); style.textContent = styles
      container.append(style)
      for (const flow of flows) {
        const details = doc.createElement('details'); details.className = 'edulog-flow'
        const summary = doc.createElement('summary')
        const heading = doc.createElement('span'); heading.className = 'edulog-flow-heading'
        const title = doc.createElement('strong'); title.className = 'edulog-flow-title'; title.textContent = flow.title
        const badge = doc.createElement('span'); badge.className = 'edulog-flow-state'; badge.textContent = '需要連線'
        heading.append(title, badge)
        const description = doc.createElement('span'); description.className = 'edulog-flow-description'; description.textContent = flow.summary
        const availability = doc.createElement('span'); availability.className = 'edulog-flow-availability'
        const expand = doc.createElement('span'); expand.className = 'edulog-flow-expand'; expand.textContent = '查看操作流程'
        summary.append(heading, description, availability, expand)
        const body = doc.createElement('div'); body.className = 'edulog-flow-body'
        const disclaimer = doc.createElement('p'); disclaimer.textContent = '完整選擇、欄位對照及差異確認會在整合工作台完成。'
        const list = doc.createElement('ol')
        for (const [label, text] of flow.steps) {
          const item = doc.createElement('li'), name = doc.createElement('strong'), detail = doc.createElement('span')
          name.textContent = label; detail.textContent = text; item.append(name, detail); list.append(item)
        }
        const note = doc.createElement('p'); note.textContent = flow.note
        const open = doc.createElement('button'); open.type = 'button'; open.textContent = `開啟${flow.title}`; open.dataset.flow = flow.id
        open.addEventListener('click', async () => {
          open.disabled = true
          try { const result = await globalThis.edulogRuntime.send({ type: 'open-integration-workspace', flow: flow.id }); if (!result?.opened) throw new Error(result?.error?.message || '無法開啟整合工作台。') }
          catch (error) { availability.textContent = error.message }
          finally { open.disabled = false }
        })
        body.append(disclaimer, list, note, open); details.append(summary, body); container.append(details)
      }
      return { update(value) {
        const status = typeof value === 'string' ? value : value?.status
        for (const card of container.querySelectorAll('.edulog-flow')) {
          const button = card.querySelector('button'), key = button.dataset.flow === 'import' ? 'teaching_data_import' : 'report_prefill'
          const ready = status === 'connected' && value?.capabilities?.[key] === true
          card.querySelector('.edulog-flow-state').textContent = ready ? '可開啟工作台' : status === 'connected' ? '伺服器尚未支援' : '需要連線'
          card.querySelector('.edulog-flow-availability').textContent = ready ? button.dataset.flow === 'import' ? '目前班級匯入；未辨識資料會列為需處理。' : '已驗證欄位可預填；人工送出後維持待確認。' : status === 'connected' ? '請更新 EduLog API 與整合資料庫 migration。' : '先連接你的 EduLog，工作台會引導你完成配對。'
          button.textContent = ready ? `開啟${button.dataset.flow === 'import' ? '教學資料匯入' : '報告預填'}` : '開啟整合工作台'
        }
      } }
    },
  })
})()
